-- ===========================================================================
-- 0018 — el admin manda en cada enfrentamiento
--
-- Desde la sala del partido el admin puede:
--   * publicar o cambiar el ID de sala en nombre del equipo anfitrión
--     (post_match_room), aunque haya un reporte pendiente;
--   * dar por terminada la preparación y arrancar la partida en curso
--     (admin_start_game);
--   * fijar el marcador de la serie (admin_set_match_score). Las partidas se
--     reescriben para que el marcador y la línea de partidas cuadren; si alguien
--     llega a las victorias necesarias, la serie se cierra y el ganador avanza.
--     En un partido ya terminado solo se corrige el marcador, no el ganador
--     (ya avanzó en el cuadro).
-- ===========================================================================

create or replace function public.post_match_room(p_match_id uuid, p_room_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m       matches;
  r       match_rooms;
  v_t     tournament_status;
  v_cap   match_side;
  v_admin boolean := is_admin();
  v_id    text := trim(coalesce(p_room_id, ''));
begin
  select * into m from matches where id = p_match_id for update;
  if not found then
    raise exception 'Partido inexistente';
  end if;
  select * into r from match_rooms where match_id = p_match_id for update;
  if not found then
    raise exception 'Este enfrentamiento todavía no está listo';
  end if;

  v_cap := match_captain_side(m);
  if v_cap is null and not v_admin then
    raise exception 'Solo los capitanes de este partido pueden publicar la sala';
  end if;
  if m.host_side is null then
    raise exception 'Primero tienen que sortear quién crea la sala';
  end if;
  if not v_admin and v_cap is distinct from m.host_side then
    raise exception 'Esta partida la crea el capitán del otro equipo';
  end if;

  select status into v_t from tournaments where id = m.tournament_id;
  if v_t <> 'running' then
    raise exception 'El torneo todavía no está en juego';
  end if;
  if m.status not in ('ready', 'live') then
    raise exception 'Este partido ya no admite cambios de sala';
  end if;
  if not v_admin and exists (select 1 from match_games
              where match_id = p_match_id and resolved_at is null and claim_side is not null) then
    raise exception 'Hay una partida reportada sin resolver; la sala no se puede cambiar ahora';
  end if;
  if v_id !~ '^[A-Za-z0-9-]{3,32}$' then
    raise exception 'El ID de sala debe tener de 3 a 32 letras, números o guiones';
  end if;

  update match_rooms set room_id = v_id, room_posted_at = now() where match_id = p_match_id;

  if not exists (select 1 from match_games where match_id = p_match_id) then
    insert into match_games (match_id, tournament_id, game_no, host_side, host_drawn, room_posted_at)
    values (p_match_id, m.tournament_id, 1, m.host_side, true, now());
  else
    update match_games
       set room_posted_at = now(), prep_started_at = now()
     where match_id = p_match_id and resolved_at is null and room_posted_at is null;
  end if;

  update matches set status = 'live', updated_at = now() where id = p_match_id;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'post_match_room', 'match', p_match_id,
          jsonb_build_object('room_id', v_id, 'by_admin', v_admin and v_cap is null));
end;
$$;

-- ---------------------------------------------------------------------------
-- El admin corta la preparación: la partida en curso empieza ya.
-- ---------------------------------------------------------------------------
create or replace function public.admin_start_game(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m   matches;
  g   match_games;
  v_t tournament_status;
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede hacer esto';
  end if;

  select * into m from matches where id = p_match_id for update;
  if not found then
    raise exception 'Partido inexistente';
  end if;
  select status into v_t from tournaments where id = m.tournament_id;
  if v_t <> 'running' or m.status <> 'live' then
    raise exception 'El partido no está en juego';
  end if;

  select * into g from match_games
   where match_id = p_match_id and resolved_at is null
   order by game_no desc limit 1
   for update;
  if not found then
    raise exception 'No hay ninguna partida en curso';
  end if;
  if g.room_posted_at is null then
    raise exception 'Primero se tiene que publicar la sala de la partida %', g.game_no;
  end if;
  if now() >= match_game_starts_at(g) then
    raise exception 'La partida % ya empezó', g.game_no;
  end if;

  update match_games
     set ready_a_at = coalesce(ready_a_at, now()),
         ready_b_at = coalesce(ready_b_at, now())
   where id = g.id;

  update matches set updated_at = now() where id = p_match_id;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'admin_start_game', 'match', p_match_id,
          jsonb_build_object('game_no', g.game_no));
end;
$$;

-- ---------------------------------------------------------------------------
-- El admin fija el marcador de la serie.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_match_score(p_match_id uuid, p_score_a smallint, p_score_b smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m        matches;
  g        match_games;
  v_t      tournament_status;
  v_need   int;
  v_qa     int := p_score_a;
  v_qb     int := p_score_b;
  v_n      int := 0;
  v_first  match_side;
  v_win    match_side;
  v_host   match_side;
  v_winner uuid;
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede cambiar el marcador';
  end if;

  select * into m from matches where id = p_match_id for update;
  if not found then
    raise exception 'Partido inexistente';
  end if;
  if m.team_a_id is null or m.team_b_id is null then
    raise exception 'El partido todavía no tiene a los dos equipos';
  end if;

  v_need := match_best_of(m) / 2 + 1;
  if p_score_a is null or p_score_b is null
     or least(p_score_a, p_score_b) < 0 or greatest(p_score_a, p_score_b) > v_need
     or (p_score_a = v_need and p_score_b = v_need) then
    raise exception 'Al mejor de %, cada equipo tiene de 0 a % victorias y solo uno puede llegar a %',
      match_best_of(m), v_need, v_need;
  end if;

  select status into v_t from tournaments where id = m.tournament_id;

  if m.status = 'done' then
    if v_t not in ('running', 'finished') then
      raise exception 'El torneo no está en juego (estado: %)', v_t;
    end if;
    if greatest(p_score_a, p_score_b) <> v_need then
      raise exception 'El partido ya terminó: el ganador tiene que seguir con % victorias', v_need;
    end if;
    if (case when p_score_a > p_score_b then m.team_a_id else m.team_b_id end)
       is distinct from m.winner_id then
      raise exception 'No se puede cambiar el ganador de un partido terminado: ya avanzó en el cuadro';
    end if;
  else
    if v_t <> 'running' then
      raise exception 'El torneo no está en juego (estado: %)', v_t;
    end if;
    if m.status not in ('ready', 'live') then
      raise exception 'Este partido no admite cambios de marcador';
    end if;
  end if;

  select host_side into v_first from match_games where match_id = p_match_id and game_no = 1;
  v_first := coalesce(v_first, m.host_side);

  -- La partida en curso se descarta (con su reporte, si lo tenía).
  delete from match_games where match_id = p_match_id and resolved_at is null;

  -- Las jugadas se conservan en orden; se invierte el ganador cuando sobra y se
  -- borran las que no caben en el marcador nuevo.
  for g in select * from match_games where match_id = p_match_id order by game_no for update loop
    if v_qa + v_qb = 0 then
      delete from match_games where id = g.id;
      continue;
    end if;
    v_win := g.winner_side;
    if v_win = 'a' and v_qa = 0 then
      v_win := 'b';
    elsif v_win = 'b' and v_qb = 0 then
      v_win := 'a';
    end if;
    if v_win is distinct from g.winner_side then
      update match_games
         set winner_side = v_win, resolved_via = 'admin',
             resolved_by = auth.uid(), resolved_at = now()
       where id = g.id;
    end if;
    if v_win = 'a' then v_qa := v_qa - 1; else v_qb := v_qb - 1; end if;
    v_n := g.game_no;
  end loop;

  -- Las que faltan se agregan como adjudicadas por el admin.
  while v_qa + v_qb > 0 loop
    v_n := v_n + 1;
    v_win := case when v_qa > 0 then 'a' else 'b' end;
    v_host := case
      when v_first is null then null
      when v_n % 2 = 1 then v_first
      when v_first = 'a' then 'b'
      else 'a'
    end;
    insert into match_games (match_id, tournament_id, game_no, host_side, host_drawn,
                             room_posted_at, winner_side, resolved_via, resolved_by, resolved_at)
    values (p_match_id, m.tournament_id, v_n, v_host, v_n = 1,
            now(), v_win, 'admin', auth.uid(), now());
    if v_win = 'a' then v_qa := v_qa - 1; else v_qb := v_qb - 1; end if;
  end loop;

  update matches set score_a = p_score_a, score_b = p_score_b, updated_at = now()
   where id = p_match_id;

  if m.status = 'done' then
    null; -- mismo ganador: solo cambia el marcador.
  elsif greatest(p_score_a, p_score_b) = v_need then
    v_winner := case when p_score_a > p_score_b then m.team_a_id else m.team_b_id end;
    perform apply_match_winner(p_match_id, v_winner, 'done');
    if m.next_match_id is null then
      update tournaments set status = 'finished' where id = m.tournament_id;
    end if;
  elsif v_n = 0 and m.status = 'ready' then
    null; -- 0–0 sin sala: queda como estaba.
  else
    if m.status = 'ready' then
      update matches set status = 'live' where id = p_match_id;
    end if;
    perform open_next_game(p_match_id, (v_n + 1)::smallint);
    -- Sin ID de sala publicado, la partida nueva espera a que lo publiquen.
    update match_games g2
       set room_posted_at = null
      from match_rooms r
     where g2.match_id = p_match_id and g2.resolved_at is null
       and r.match_id = p_match_id and r.room_id is null;
  end if;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'admin_set_match_score', 'match', p_match_id,
          jsonb_build_object('score_a', p_score_a, 'score_b', p_score_b,
                             'prev_a', m.score_a, 'prev_b', m.score_b));
end;
$$;

revoke execute on function public.post_match_room(uuid, text)                       from public, anon;
revoke execute on function public.admin_start_game(uuid)                            from public, anon;
revoke execute on function public.admin_set_match_score(uuid, smallint, smallint)   from public, anon;

grant execute on function public.post_match_room(uuid, text)                        to authenticated;
grant execute on function public.admin_start_game(uuid)                             to authenticated;
grant execute on function public.admin_set_match_score(uuid, smallint, smallint)    to authenticated;
