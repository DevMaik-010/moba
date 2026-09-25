-- ===========================================================================
-- 0005 — equipos guardados, archivo de torneos y cierre automático
--
-- Equipos guardados
-- -----------------
-- Un equipo ahora pertenece al usuario, no a un torneo: se arma una vez en
-- "Mis equipos" y se inscribe con un clic en cada torneo nuevo del mismo modo.
-- Al inscribirlo se copia una FOTO del roster a `teams` / `team_members`, así
-- que editar el equipo guardado después no altera torneos ya jugados ni un
-- cuadro en curso, y toda la lógica de cuadro de 0002 sigue igual.
--
-- El estado de validación de cada ID NO lo manda el cliente: se toma de
-- `mlbb_account_cache`, que solo escribe el servidor (service role) y el admin.
--
-- Archivo
-- -------
-- Un torneo finalizado o cancelado se puede archivar: sale de la lista pública
-- pero su página y su historial siguen existiendo.
--
-- Cierre automático
-- -----------------
-- Cuando el último cupo se llena, register_team cierra las inscripciones con
-- la misma lógica que el botón del admin.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Esquema
-- ---------------------------------------------------------------------------
alter table tournaments add column if not exists archived_at timestamptz;

create table if not exists saved_teams (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references profiles (id) on delete cascade,
  name       text not null check (length(trim(name)) between 2 and 40),
  tag        text not null default '' check (length(tag) <= 6),
  mode       tournament_mode not null,
  team_size  smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_team_size_matches_mode check (
    (mode = '1v1' and team_size = 1) or
    (mode = '3v3' and team_size = 3) or
    (mode = '5v5' and team_size = 5)
  )
);

create index if not exists saved_teams_owner_idx on saved_teams (owner_id, created_at desc);

create table if not exists saved_team_members (
  id                uuid primary key default gen_random_uuid(),
  saved_team_id     uuid not null references saved_teams (id) on delete cascade,
  slot              smallint not null check (slot >= 1),
  game_user_id      text not null check (game_user_id ~ '^[0-9]{5,12}$'),
  zone_id           text not null check (zone_id ~ '^[0-9]{3,6}$'),
  nickname          text,
  validation_status validation_status not null default 'pending',
  validated_at      timestamptz,
  unique (saved_team_id, slot),
  constraint saved_team_members_unique_player unique (saved_team_id, game_user_id, zone_id)
);

create index if not exists saved_team_members_player_idx
  on saved_team_members (game_user_id, zone_id);

-- De qué equipo guardado salió cada inscripción (null en las anteriores a 0005).
alter table teams
  add column if not exists saved_team_id uuid references saved_teams (id) on delete set null;
create index if not exists teams_saved_team_idx on teams (saved_team_id);

-- ---------------------------------------------------------------------------
-- RLS — lectura y borrado directos; crear y editar va por RPC.
-- ---------------------------------------------------------------------------
alter table saved_teams        enable row level security;
alter table saved_team_members enable row level security;

drop policy if exists saved_teams_owner_read on saved_teams;
create policy saved_teams_owner_read on saved_teams
  for select using (owner_id = auth.uid() or is_admin());

drop policy if exists saved_teams_owner_delete on saved_teams;
create policy saved_teams_owner_delete on saved_teams
  for delete using (owner_id = auth.uid());

drop policy if exists saved_team_members_owner_read on saved_team_members;
create policy saved_team_members_owner_read on saved_team_members
  for select using (
    exists (select 1 from saved_teams s where s.id = saved_team_id and s.owner_id = auth.uid())
    or is_admin()
  );

-- Inscribir ahora pasa siempre por RPC. Estas políticas dejaban al capitán
-- escribir team_members a mano, incluido un validation_status inventado.
drop policy if exists teams_captain_insert       on teams;
drop policy if exists teams_captain_update_draft on teams;
drop policy if exists teams_captain_delete_draft on teams;
drop policy if exists team_members_captain_write on team_members;

-- ---------------------------------------------------------------------------
-- Backfill: cada equipo ya inscrito se convierte en equipo guardado de su capitán.
-- ---------------------------------------------------------------------------
do $$
declare
  r     record;
  v_new uuid;
begin
  for r in
    select t.*, tr.mode as t_mode, tr.team_size as t_size
      from teams t join tournaments tr on tr.id = t.tournament_id
     where t.saved_team_id is null
     order by t.created_at
  loop
    insert into saved_teams (owner_id, name, tag, mode, team_size, created_at)
    values (r.captain_id, r.name, left(r.tag, 6), r.t_mode, r.t_size, r.created_at)
    returning id into v_new;

    insert into saved_team_members (saved_team_id, slot, game_user_id, zone_id, nickname,
                                    validation_status, validated_at)
    select v_new, m.slot, m.game_user_id, m.zone_id, m.nickname, m.validation_status, m.validated_at
      from team_members m where m.team_id = r.id
    on conflict do nothing;

    update teams set saved_team_id = v_new where id = r.id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- upsert_saved_team — crea o edita un equipo guardado de forma atómica.
-- p_members: [{ "slot": 1, "gameUserId": "...", "zoneId": "..." }, ...]
-- ---------------------------------------------------------------------------
create or replace function public.upsert_saved_team(
  p_saved_team_id uuid,
  p_name          text,
  p_tag           text,
  p_mode          tournament_mode,
  p_members       jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team saved_teams;
  v_id   uuid;
  v_size smallint := case p_mode when '1v1' then 1 when '3v3' then 3 else 5 end;
begin
  if auth.uid() is null then
    raise exception 'Necesitas iniciar sesión';
  end if;
  if jsonb_array_length(p_members) <> v_size then
    raise exception 'El modo % necesita % jugadores', p_mode, v_size;
  end if;

  if p_saved_team_id is null then
    insert into saved_teams (owner_id, name, tag, mode, team_size)
    values (auth.uid(), trim(p_name), trim(p_tag), p_mode, v_size)
    returning id into v_id;
  else
    select * into v_team from saved_teams where id = p_saved_team_id for update;
    if not found or v_team.owner_id is distinct from auth.uid() then
      raise exception 'Equipo inexistente';
    end if;
    if v_team.mode <> p_mode then
      raise exception 'El modo de un equipo no se cambia: crea otro equipo para %', p_mode;
    end if;

    update saved_teams
       set name = trim(p_name), tag = trim(p_tag), updated_at = now()
     where id = p_saved_team_id;
    delete from saved_team_members where saved_team_id = p_saved_team_id;
    v_id := p_saved_team_id;
  end if;

  -- El veredicto sale de la caché (escrita por el servidor o por el admin);
  -- sin veredicto, el ID queda pendiente.
  insert into saved_team_members (saved_team_id, slot, game_user_id, zone_id, nickname,
                                  validation_status, validated_at)
  select v_id,
         (m->>'slot')::smallint,
         m->>'gameUserId',
         m->>'zoneId',
         c.nickname,
         coalesce(c.status, 'pending'),
         case when c.status is null or c.status = 'pending' then null else c.checked_at end
    from jsonb_array_elements(p_members) m
    left join mlbb_account_cache c
      on c.game_user_id = m->>'gameUserId' and c.zone_id = m->>'zoneId';

  return v_id;
exception
  when unique_violation then
    if sqlerrm like '%saved_team_members_unique_player%' then
      raise exception 'Hay un ID repetido en el roster';
    else
      raise;
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- lock_tournament — se parte en dos: el núcleo sin chequeo de rol (lo usa
-- también el cierre automático) y la función pública que exige admin.
-- ---------------------------------------------------------------------------
create or replace function public.lock_tournament_core(p_tournament_id uuid)
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
  select * into v_t from tournaments where id = p_tournament_id for update;
  if v_t.status <> 'open' then
    raise exception 'El torneo no está abierto (estado: %)', v_t.status;
  end if;
  if (select count(*) from teams where tournament_id = p_tournament_id and seed is not null) < 2 then
    raise exception 'Hacen falta al menos 2 equipos inscritos';
  end if;

  update tournaments set status = 'locked' where id = p_tournament_id;

  v_rounds := (ln(v_t.bracket_size) / ln(2))::int;

  for r in
    select * from matches
     where tournament_id = p_tournament_id and round = 1 and status = 'pending'
     order by slot
  loop
    if r.team_a_id is null and r.team_b_id is null then
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
    end loop;
  end loop;
end;
$$;

create or replace function public.lock_tournament(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede cerrar las inscripciones';
  end if;

  perform lock_tournament_core(p_tournament_id);

  insert into audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'lock_tournament', 'tournament', p_tournament_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- register_team — igual que en 0004 + cierre automático al llenarse.
-- Ojo: `seed` es también columna de salida de la función, por eso todas las
-- referencias a teams.seed van calificadas.
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
  if v_team.captain_id is distinct from auth.uid() and not is_admin() then
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

  -- Último cupo ocupado: se cierran las inscripciones solas.
  if (select count(*) from teams t3 where t3.tournament_id = v_t.id and t3.seed is not null)
     >= v_t.bracket_size then
    perform lock_tournament_core(v_t.id);
    insert into audit_log (actor_id, action, entity, entity_id)
    values (auth.uid(), 'auto_lock_tournament', 'tournament', v_t.id);
  end if;

  return query select v_seed::smallint, v_match, v_slot::smallint, v_side;
end;
$$;

-- ---------------------------------------------------------------------------
-- register_saved_team — copia la foto del equipo guardado al torneo y lo
-- inscribe. Todo o nada: si register_team falla, no queda ningún borrador.
-- ---------------------------------------------------------------------------
create or replace function public.register_saved_team(p_saved_team_id uuid, p_tournament_id uuid)
returns table (seed smallint, match_id uuid, match_slot smallint, side match_side)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saved saved_teams;
  v_t     tournaments;
  v_team  uuid;
begin
  select * into v_saved from saved_teams where id = p_saved_team_id;
  if not found or v_saved.owner_id is distinct from auth.uid() then
    raise exception 'Equipo inexistente';
  end if;

  select * into v_t from tournaments where id = p_tournament_id;
  if not found then
    raise exception 'Torneo inexistente';
  end if;
  if v_t.status <> 'open' then
    raise exception 'Las inscripciones de este torneo están cerradas';
  end if;
  if v_t.mode <> v_saved.mode then
    raise exception 'Este torneo es %, y tu equipo es %', v_t.mode, v_saved.mode;
  end if;
  if exists (select 1 from teams t0
              where t0.tournament_id = p_tournament_id and t0.captain_id = auth.uid()
                and t0.status <> 'draft') then
    raise exception 'Ya tienes un equipo inscrito en este torneo';
  end if;

  -- Un borrador del flujo anterior (save_team_roster) chocaría con el índice
  -- de un equipo por capitán: se descarta.
  delete from teams
   where tournament_id = p_tournament_id and captain_id = auth.uid() and status = 'draft';

  insert into teams (tournament_id, name, tag, captain_id, saved_team_id)
  values (p_tournament_id, v_saved.name, v_saved.tag, auth.uid(), v_saved.id)
  returning id into v_team;

  -- Si la caché tiene un veredicto más reciente (p. ej. el admin lo resolvió),
  -- manda la caché; si no, lo guardado.
  insert into team_members (team_id, tournament_id, slot, game_user_id, zone_id, nickname,
                            is_captain, validation_status, validated_at)
  select v_team, p_tournament_id, m.slot, m.game_user_id, m.zone_id,
         coalesce(c.nickname, m.nickname),
         m.slot = 1,
         case when c.status is not null and c.status <> 'pending' then c.status
              else m.validation_status end,
         case when c.status is not null and c.status <> 'pending' then c.checked_at
              else m.validated_at end
    from saved_team_members m
    left join mlbb_account_cache c
      on c.game_user_id = m.game_user_id and c.zone_id = m.zone_id
   where m.saved_team_id = v_saved.id;

  return query select * from register_team(v_team);
exception
  when unique_violation then
    if sqlerrm like '%team_members_unique_player%' then
      raise exception 'Uno de tus jugadores ya está inscrito en otro equipo de este torneo';
    elsif sqlerrm like '%teams_name_per_tournament%' then
      raise exception 'Ya hay un equipo llamado "%" en este torneo: cámbiale el nombre', v_saved.name;
    elsif sqlerrm like '%teams_captain_per_tournament%' then
      raise exception 'Ya tienes un equipo inscrito en este torneo';
    else
      raise;
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- resolve_member_validation — además de la fila del torneo, el veredicto del
-- admin se guarda en la caché y en los equipos guardados con ese ID, para no
-- tener que volver a revisarlo en el próximo torneo.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_member_validation(
  p_member_id uuid,
  p_status    validation_status,
  p_nickname  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m team_members;
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
   where id = p_member_id
  returning * into v_m;

  if found then
    insert into mlbb_account_cache (game_user_id, zone_id, nickname, status, provider, checked_at)
    values (v_m.game_user_id, v_m.zone_id, v_m.nickname, p_status, 'admin', now())
    on conflict (game_user_id, zone_id) do update
      set status = excluded.status,
          nickname = coalesce(excluded.nickname, mlbb_account_cache.nickname),
          provider = 'admin',
          checked_at = now();

    update saved_team_members
       set validation_status = p_status,
           nickname = coalesce(p_nickname, nickname),
           validated_at = now()
     where game_user_id = v_m.game_user_id and zone_id = v_m.zone_id;
  end if;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'resolve_member_validation', 'team_member', p_member_id,
          jsonb_build_object('status', p_status));
end;
$$;

-- ---------------------------------------------------------------------------
-- set_tournament_archived — solo torneos terminados o cancelados.
-- ---------------------------------------------------------------------------
create or replace function public.set_tournament_archived(p_tournament_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t tournaments;
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede archivar torneos';
  end if;

  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'Torneo inexistente';
  end if;
  if p_archived and v_t.status not in ('finished', 'cancelled') then
    raise exception 'Solo se archivan torneos finalizados o cancelados';
  end if;

  update tournaments
     set archived_at = case when p_archived then now() else null end
   where id = p_tournament_id;

  insert into audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), case when p_archived then 'archive_tournament' else 'unarchive_tournament' end,
          'tournament', p_tournament_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke execute on function public.lock_tournament_core(uuid) from public, anon, authenticated;
-- Flujo viejo de borradores: confiaba en el validation_status que mandaba el cliente.
revoke execute on function public.save_team_roster(uuid, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.upsert_saved_team(uuid, text, text, tournament_mode, jsonb) to authenticated;
grant execute on function public.register_saved_team(uuid, uuid)                              to authenticated;
grant execute on function public.set_tournament_archived(uuid, boolean)                        to authenticated;
