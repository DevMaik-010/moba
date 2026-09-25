-- Lógica de torneo. Todo `security definer` para que sea atómica y no dependa
-- de que el cliente se porte bien.

-- ---------------------------------------------------------------------------
-- set_user_role — el primer admin se crea con la service role (scripts/).
-- ---------------------------------------------------------------------------
create function public.set_user_role(p_profile_id uuid, p_role app_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede cambiar roles';
  end if;

  update profiles set role = p_role where id = p_profile_id;
  if not found then
    raise exception 'Perfil inexistente';
  end if;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'set_user_role', 'profile', p_profile_id, jsonb_build_object('role', p_role));
end;
$$;

-- ---------------------------------------------------------------------------
-- open_tournament — dibuja el cuadro COMPLETO vacío y abre inscripciones.
-- Los cuadritos existen desde el minuto cero; inscribirse solo los va llenando.
-- ---------------------------------------------------------------------------
create function public.open_tournament(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t      tournaments;
  v_rounds int;
  v_round  int;
  v_slots  int;
  v_slot   int;
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede abrir un torneo';
  end if;

  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'Torneo inexistente';
  end if;
  if v_t.status <> 'draft' then
    raise exception 'El torneo ya fue abierto (estado: %)', v_t.status;
  end if;

  v_rounds := (ln(v_t.bracket_size) / ln(2))::int;

  for v_round in 1 .. v_rounds loop
    v_slots := (v_t.bracket_size / (2 ^ v_round))::int;
    for v_slot in 1 .. v_slots loop
      insert into matches (tournament_id, round, slot)
      values (p_tournament_id, v_round, v_slot);
    end loop;
  end loop;

  -- Cada match apunta al de la ronda siguiente: slots 1 y 2 caen en el slot 1,
  -- 3 y 4 en el 2, etc. El impar entra por el lado A y el par por el lado B.
  update matches m
     set next_match_id = n.id,
         next_side = case when m.slot % 2 = 1 then 'a'::match_side else 'b'::match_side end
    from matches n
   where m.tournament_id = p_tournament_id
     and n.tournament_id = p_tournament_id
     and n.round = m.round + 1
     and n.slot = ceil(m.slot::numeric / 2);

  update tournaments set status = 'open' where id = p_tournament_id;

  insert into audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'open_tournament', 'tournament', p_tournament_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- register_team — toma el siguiente seed libre y coloca al equipo en el cuadro.
-- El `for update` sobre el torneo serializa dos inscripciones simultáneas, así
-- que nunca dos equipos reciben el mismo seed.
-- ---------------------------------------------------------------------------
create function public.register_team(p_team_id uuid)
returns table (seed smallint, match_id uuid, match_slot smallint, side match_side)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team    teams;
  v_t       tournaments;
  v_members int;
  v_bad     int;
  v_seed    int;
  v_slot    int;
  v_side    match_side;
  v_match   uuid;
begin
  select * into v_team from teams where id = p_team_id;
  if not found then
    raise exception 'Equipo inexistente';
  end if;
  if v_team.captain_id <> auth.uid() and not is_admin() then
    raise exception 'Solo el capitán puede inscribir a este equipo';
  end if;
  if v_team.status <> 'draft' then
    raise exception 'El equipo ya está inscrito';
  end if;

  select * into v_t from tournaments where id = v_team.tournament_id for update;
  if v_t.status <> 'open' then
    raise exception 'Las inscripciones de este torneo están cerradas';
  end if;

  select count(*) into v_members from team_members where team_id = p_team_id;
  if v_members <> v_t.team_size then
    raise exception 'El equipo necesita % jugadores y tiene %', v_t.team_size, v_members;
  end if;

  -- Un ID `pending` (proveedor caído) no bloquea: lo resuelve el admin después.
  select count(*) into v_bad
    from team_members
   where team_id = p_team_id
     and validation_status in ('invalid', 'manual_rejected');
  if v_bad > 0 then
    raise exception 'El roster tiene % ID(s) rechazados', v_bad;
  end if;

  select coalesce(max(t2.seed), 0) + 1 into v_seed
    from teams t2 where t2.tournament_id = v_t.id;

  if v_seed > v_t.bracket_size then
    raise exception 'El torneo está lleno (% cupos)', v_t.bracket_size;
  end if;

  v_slot := ceil(v_seed::numeric / 2);
  v_side := case when v_seed % 2 = 1 then 'a' else 'b' end;

  update teams set seed = v_seed, status = 'registered' where id = p_team_id;

  update matches
     set team_a_id  = case when v_side = 'a' then p_team_id else team_a_id end,
         team_b_id  = case when v_side = 'b' then p_team_id else team_b_id end,
         updated_at = now()
   where tournament_id = v_t.id and round = 1 and slot = v_slot
  returning id into v_match;

  update matches
     set status = 'ready'
   where id = v_match and team_a_id is not null and team_b_id is not null;

  return query select v_seed::smallint, v_match, v_slot::smallint, v_side;
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_match_winner — helper interno: fija ganador, elimina al perdedor y
-- empuja al ganador al match siguiente.
-- ---------------------------------------------------------------------------
create function public.apply_match_winner(p_match_id uuid, p_winner uuid, p_status match_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m matches;
begin
  select * into m from matches where id = p_match_id;

  update matches
     set winner_id = p_winner, status = p_status, updated_at = now()
   where id = p_match_id;

  -- Solo hay perdedor si el match se jugó de verdad (dos equipos presentes).
  if m.team_a_id is not null and m.team_b_id is not null then
    update teams set status = 'eliminated'
     where id = case when p_winner = m.team_a_id then m.team_b_id else m.team_a_id end;
  end if;

  if m.next_match_id is not null and p_winner is not null then
    if m.next_side = 'a' then
      update matches set team_a_id = p_winner, updated_at = now() where id = m.next_match_id;
    else
      update matches set team_b_id = p_winner, updated_at = now() where id = m.next_match_id;
    end if;

    update matches
       set status = 'ready'
     where id = m.next_match_id
       and team_a_id is not null and team_b_id is not null
       and status = 'pending';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- lock_tournament — cierra inscripciones y resuelve los byes.
--
-- Ojo con la regla de las rondas superiores: un hueco NO es un bye solo por
-- estar vacío, porque casi todos los huecos de ronda 2 están vacíos mientras la
-- ronda 1 no se juega. Un hueco es definitivo únicamente si el partido que lo
-- alimenta es una rama muerta (bye sin ganador). Así un bye puede encadenar
-- otro hacia arriba sin adjudicar partidos que todavía se van a jugar.
-- ---------------------------------------------------------------------------
create function public.lock_tournament(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t      tournaments;
  v_rounds int;
  v_round  int;
  r        matches;
  v_a_dead boolean;
  v_b_dead boolean;
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede cerrar las inscripciones';
  end if;

  select * into v_t from tournaments where id = p_tournament_id for update;
  if v_t.status <> 'open' then
    raise exception 'El torneo no está abierto (estado: %)', v_t.status;
  end if;
  if (select count(*) from teams where tournament_id = p_tournament_id and seed is not null) < 2 then
    raise exception 'Hacen falta al menos 2 equipos inscritos';
  end if;

  update tournaments set status = 'locked' where id = p_tournament_id;

  v_rounds := (ln(v_t.bracket_size) / ln(2))::int;

  -- Ronda 1: se resuelve con lo que se haya inscrito, no hay nada que esperar.
  for r in
    select * from matches
     where tournament_id = p_tournament_id and round = 1 and status = 'pending'
     order by slot
  loop
    if r.team_a_id is null and r.team_b_id is null then
      -- Rama muerta: ese trozo del cuadro nunca se llenó.
      update matches set status = 'bye', updated_at = now() where id = r.id;
    elsif (r.team_a_id is null) <> (r.team_b_id is null) then
      perform apply_match_winner(r.id, coalesce(r.team_a_id, r.team_b_id), 'bye');
    end if;
  end loop;

  for v_round in 2 .. v_rounds loop
    for r in
      select * from matches
       where tournament_id = p_tournament_id and round = v_round and status = 'pending'
       order by slot
    loop
      select exists (
        select 1 from matches f
         where f.next_match_id = r.id and f.next_side = 'a'
           and f.status = 'bye' and f.winner_id is null
      ) into v_a_dead;

      select exists (
        select 1 from matches f
         where f.next_match_id = r.id and f.next_side = 'b'
           and f.status = 'bye' and f.winner_id is null
      ) into v_b_dead;

      if v_a_dead and v_b_dead then
        update matches set status = 'bye', updated_at = now() where id = r.id;
      elsif v_a_dead and r.team_b_id is not null then
        perform apply_match_winner(r.id, r.team_b_id, 'bye');
      elsif v_b_dead and r.team_a_id is not null then
        perform apply_match_winner(r.id, r.team_a_id, 'bye');
      end if;
      -- En cualquier otro caso el partido espera a que se juegue su ronda previa.
    end loop;
  end loop;

  insert into audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'lock_tournament', 'tournament', p_tournament_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- start_tournament — de 'locked' a 'running'; da margen para revisar el cuadro.
-- ---------------------------------------------------------------------------
create function public.start_tournament(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede iniciar el torneo';
  end if;

  update tournaments set status = 'running'
   where id = p_tournament_id and status = 'locked';
  if not found then
    raise exception 'El torneo debe estar cerrado antes de iniciar';
  end if;

  insert into audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'start_tournament', 'tournament', p_tournament_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- report_match — resultado y avance del ganador.
-- ---------------------------------------------------------------------------
create function public.report_match(p_match_id uuid, p_score_a smallint, p_score_b smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m      matches;
  v_t    tournaments;
  v_win  uuid;
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede reportar resultados';
  end if;
  if p_score_a = p_score_b then
    raise exception 'No se admiten empates';
  end if;

  select * into m from matches where id = p_match_id for update;
  if not found then
    raise exception 'Partido inexistente';
  end if;
  if m.team_a_id is null or m.team_b_id is null then
    raise exception 'El partido todavía no tiene a los dos equipos';
  end if;
  if m.status = 'done' then
    raise exception 'Este partido ya fue reportado';
  end if;

  select * into v_t from tournaments where id = m.tournament_id;
  if v_t.status <> 'running' then
    raise exception 'El torneo no está en juego (estado: %)', v_t.status;
  end if;

  v_win := case when p_score_a > p_score_b then m.team_a_id else m.team_b_id end;

  update matches set score_a = p_score_a, score_b = p_score_b where id = p_match_id;
  perform apply_match_winner(p_match_id, v_win, 'done');

  -- Sin match siguiente = era la final.
  if m.next_match_id is null then
    update tournaments set status = 'finished' where id = m.tournament_id;
  end if;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'report_match', 'match', p_match_id,
          jsonb_build_object('score_a', p_score_a, 'score_b', p_score_b, 'winner', v_win));
end;
$$;

-- ---------------------------------------------------------------------------
-- resolve_member_validation — cola manual del admin cuando el proveedor falla.
-- ---------------------------------------------------------------------------
create function public.resolve_member_validation(
  p_member_id uuid,
  p_status    validation_status,
  p_nickname  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede validar IDs';
  end if;
  if p_status not in ('manual_ok', 'manual_rejected') then
    raise exception 'La resolución manual solo admite manual_ok o manual_rejected';
  end if;

  update team_members
     set validation_status = p_status,
         nickname = coalesce(p_nickname, nickname),
         validated_at = now()
   where id = p_member_id;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'resolve_member_validation', 'team_member', p_member_id,
          jsonb_build_object('status', p_status));
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke execute on function public.apply_match_winner(uuid, uuid, match_status) from public, anon, authenticated;

grant execute on function public.set_user_role(uuid, app_role)                       to authenticated;
grant execute on function public.open_tournament(uuid)                               to authenticated;
grant execute on function public.register_team(uuid)                                 to authenticated;
grant execute on function public.lock_tournament(uuid)                               to authenticated;
grant execute on function public.start_tournament(uuid)                              to authenticated;
grant execute on function public.report_match(uuid, smallint, smallint)              to authenticated;
grant execute on function public.resolve_member_validation(uuid, validation_status, text) to authenticated;
