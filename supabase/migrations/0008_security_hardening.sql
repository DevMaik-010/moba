-- ===========================================================================
-- 0008 — endurecimiento tras la revisión de seguridad
--
-- 1. team_members dejaba leer el ID de juego y la zona de TODOS los jugadores
--    inscritos a cualquiera, incluso sin sesión. Ahora: su capitán y el admin.
-- 2. mlbb_account_cache era legible por cualquier usuario con sesión, con las
--    respuestas crudas de los proveedores (incluido el token uidGameData de
--    gamecasela). Solo la usan el servidor (service role) y las RPC.
-- 3. display_name sin límite: un nombre de 10 000 caracteres rompía la UI.
-- 4. upsert_saved_team no validaba los puestos: llamándola directo se podía
--    guardar un roster sin puesto 1 (sin capitán) o con huecos.
-- 5. post_match_room comparaba host_side con `<>`, que con NULL no bloquea.
-- 6. set_user_role dejaba a un admin quitarse el rol a sí mismo por RPC.
-- ===========================================================================

-- 1 ---------------------------------------------------------------------------
drop policy if exists team_members_read on team_members;
create policy team_members_read on team_members
  for select using (
    exists (select 1 from teams t where t.id = team_id and t.captain_id = auth.uid())
    or is_admin()
  );

-- 2 ---------------------------------------------------------------------------
drop policy if exists mlbb_cache_read_authenticated on mlbb_account_cache;
drop policy if exists mlbb_cache_admin_read on mlbb_account_cache;
create policy mlbb_cache_admin_read on mlbb_account_cache for select using (is_admin());

-- 3 ---------------------------------------------------------------------------
alter table profiles drop constraint if exists profiles_display_name_length;
alter table profiles
  add constraint profiles_display_name_length check (length(display_name) <= 40);

-- El registro puede llegar directo a Supabase Auth, sin pasar por la app: se
-- recorta aquí para que un nombre largo no haga fallar el alta.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(trim(coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))), 40)
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 4 ---------------------------------------------------------------------------
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
  if jsonb_typeof(p_members) <> 'array' or jsonb_array_length(p_members) <> v_size then
    raise exception 'El modo % necesita % jugadores', p_mode, v_size;
  end if;
  -- Puestos 1..N sin huecos ni repetidos: el 1 es el capitán.
  if (select array_agg((m->>'slot')::int order by (m->>'slot')::int)
        from jsonb_array_elements(p_members) m)
     is distinct from
     (select array_agg(g order by g) from generate_series(1, v_size) g) then
    raise exception 'Los jugadores deben ocupar los puestos 1 a %', v_size;
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
  when check_violation then
    raise exception 'Revisa los datos: nombre de 2 a 40 caracteres, tag hasta 6, IDs y zonas numéricos';
end;
$$;

-- 5 ---------------------------------------------------------------------------
create or replace function public.post_match_room(p_match_id uuid, p_room_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m     matches;
  r     match_rooms;
  v_t   tournament_status;
  v_cap match_side;
  v_id  text := trim(coalesce(p_room_id, ''));
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
  if v_cap is null then
    raise exception 'Solo los capitanes de este partido pueden publicar la sala';
  end if;
  if v_cap is distinct from m.host_side then
    raise exception 'La sala la crea el capitán del otro equipo';
  end if;

  select status into v_t from tournaments where id = m.tournament_id;
  if v_t <> 'running' then
    raise exception 'El torneo todavía no está en juego';
  end if;
  if m.status not in ('ready', 'live') then
    raise exception 'Este partido ya no admite cambios de sala';
  end if;
  if r.claim_side is not null and r.resolved_at is null then
    raise exception 'Ya hay un resultado reportado; la sala no se puede cambiar';
  end if;
  if v_id !~ '^[A-Za-z0-9-]{3,32}$' then
    raise exception 'El ID de sala debe tener de 3 a 32 letras, números o guiones';
  end if;

  update match_rooms set room_id = v_id, room_posted_at = now() where match_id = p_match_id;
  update matches set status = 'live', updated_at = now() where id = p_match_id;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'post_match_room', 'match', p_match_id, jsonb_build_object('room_id', v_id));
end;
$$;

-- 6 ---------------------------------------------------------------------------
create or replace function public.set_user_role(p_profile_id uuid, p_role app_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede cambiar roles';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'No puedes cambiar tu propio rol';
  end if;

  update profiles set role = p_role where id = p_profile_id;
  if not found then
    raise exception 'Perfil inexistente';
  end if;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'set_user_role', 'profile', p_profile_id, jsonb_build_object('role', p_role));
end;
$$;

-- `create or replace` conserva los permisos, pero se reafirman por claridad.
revoke execute on function public.upsert_saved_team(uuid, text, text, tournament_mode, jsonb) from public, anon;
revoke execute on function public.post_match_room(uuid, text)   from public, anon;
revoke execute on function public.set_user_role(uuid, app_role) from public, anon;
grant  execute on function public.upsert_saved_team(uuid, text, text, tournament_mode, jsonb) to authenticated;
grant  execute on function public.post_match_room(uuid, text)   to authenticated;
grant  execute on function public.set_user_role(uuid, app_role) to authenticated;
