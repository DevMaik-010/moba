-- ===========================================================================
-- 0004 — gestión de torneos desde el admin
--
-- Editar, cancelar y eliminar torneos, y sacar equipos mientras las
-- inscripciones siguen abiertas. Idempotente: se puede correr dos veces.
--
-- Reglas
-- ------
-- * Nombre, reglas e inicio se editan siempre, salvo en torneos finalizados o
--   cancelados. Modo y cupos solo en borrador: después el cuadro ya existe.
-- * El slug no cambia al renombrar, así los enlaces compartidos siguen vivos.
-- * Cancelar congela el torneo tal cual (cuadro y equipos quedan de registro).
-- * Solo se elimina un torneo en borrador, cancelado o finalizado; uno en curso
--   hay que cancelarlo primero, para que borrarlo nunca sea un clic accidental.
-- * Un equipo se puede quitar en borrador o con inscripciones abiertas. Su
--   cupo queda libre y register_team lo reutiliza.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- update_tournament
-- ---------------------------------------------------------------------------
create or replace function public.update_tournament(
  p_tournament_id uuid,
  p_name          text,
  p_rules         text,
  p_starts_at     timestamptz,
  p_mode          tournament_mode,
  p_bracket_size  smallint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t tournaments;
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede editar torneos';
  end if;

  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'Torneo inexistente';
  end if;
  if v_t.status in ('finished', 'cancelled') then
    raise exception 'Un torneo % ya no se puede editar', v_t.status;
  end if;
  if v_t.status <> 'draft'
     and (p_mode <> v_t.mode or p_bracket_size <> v_t.bracket_size) then
    raise exception 'El modo y los cupos solo se cambian en borrador: el cuadro ya está dibujado';
  end if;

  update tournaments
     set name         = trim(p_name),
         rules        = coalesce(p_rules, ''),
         starts_at    = p_starts_at,
         mode         = p_mode,
         team_size    = case p_mode when '1v1' then 1 when '3v3' then 3 else 5 end,
         bracket_size = p_bracket_size
   where id = p_tournament_id;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'update_tournament', 'tournament', p_tournament_id,
          jsonb_build_object('name', p_name, 'mode', p_mode, 'bracket_size', p_bracket_size));
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_tournament
-- ---------------------------------------------------------------------------
create or replace function public.cancel_tournament(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede cancelar torneos';
  end if;

  update tournaments set status = 'cancelled'
   where id = p_tournament_id and status not in ('finished', 'cancelled');
  if not found then
    raise exception 'El torneo no existe o ya terminó';
  end if;

  insert into audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'cancel_tournament', 'tournament', p_tournament_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_tournament — equipos, rosters y partidos se van en cascada.
-- ---------------------------------------------------------------------------
create or replace function public.delete_tournament(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t tournaments;
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede eliminar torneos';
  end if;

  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'Torneo inexistente';
  end if;
  if v_t.status not in ('draft', 'cancelled', 'finished') then
    raise exception 'Cancela el torneo antes de eliminarlo (estado: %)', v_t.status;
  end if;

  delete from tournaments where id = p_tournament_id;

  -- audit_log.entity_id no es FK, así que la huella sobrevive al borrado.
  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'delete_tournament', 'tournament', p_tournament_id,
          jsonb_build_object('name', v_t.name, 'slug', v_t.slug, 'status', v_t.status));
end;
$$;

-- ---------------------------------------------------------------------------
-- remove_team — saca un equipo del torneo y libera su cuadrito.
-- ---------------------------------------------------------------------------
create or replace function public.remove_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams;
  v_t    tournaments;
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede quitar equipos';
  end if;

  select * into v_team from teams where id = p_team_id;
  if not found then
    raise exception 'Equipo inexistente';
  end if;

  select * into v_t from tournaments where id = v_team.tournament_id for update;
  if v_t.status not in ('draft', 'open') then
    raise exception 'Solo se quitan equipos con las inscripciones abiertas (estado: %)', v_t.status;
  end if;

  -- El FK de matches ya pone NULL al borrar, pero el partido además tiene que
  -- volver a 'pending' porque le falta un rival.
  update matches
     set team_a_id  = case when team_a_id = p_team_id then null else team_a_id end,
         team_b_id  = case when team_b_id = p_team_id then null else team_b_id end,
         status     = 'pending',
         updated_at = now()
   where tournament_id = v_t.id
     and (team_a_id = p_team_id or team_b_id = p_team_id);

  delete from teams where id = p_team_id;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'remove_team', 'team', p_team_id,
          jsonb_build_object('tournament_id', v_t.id, 'name', v_team.name, 'seed', v_team.seed));
end;
$$;

-- ---------------------------------------------------------------------------
-- register_team — igual que en 0002, pero toma el PRIMER cupo libre en vez de
-- max(seed) + 1, para reutilizar el hueco que deja un equipo quitado.
-- ---------------------------------------------------------------------------
create or replace function public.register_team(p_team_id uuid)
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

  select min(s) into v_seed
    from generate_series(1, v_t.bracket_size) s
   where not exists (
     select 1 from teams t2 where t2.tournament_id = v_t.id and t2.seed = s
   );

  if v_seed is null then
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
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
grant execute on function public.update_tournament(uuid, text, text, timestamptz, tournament_mode, smallint) to authenticated;
grant execute on function public.cancel_tournament(uuid) to authenticated;
grant execute on function public.delete_tournament(uuid) to authenticated;
grant execute on function public.remove_team(uuid)       to authenticated;
