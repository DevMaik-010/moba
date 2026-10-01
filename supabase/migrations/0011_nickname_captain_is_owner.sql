-- ===========================================================================
-- 0011 — el nick verificado es el nombre visible y el capitán es el dueño
--
-- Nombre visible
-- --------------
-- El registro ya no pide nombre: se muestra el nick de MLBB en cuanto el ID
-- queda verificado (por el verificador o por el admin). Mientras no haya
-- nick, la cuenta se muestra como "Jugador <ID>".
--
-- Capitán
-- -------
-- Quien arma un equipo es su capitán: el jugador 1 es siempre el ID de la
-- cuenta. En un 5v5 solo se cargan los otros 4; en un 1v1, ninguno.
-- ===========================================================================

-- Nombre a mostrar para una cuenta con ese nick e ID.
create or replace function public.profile_display_name(p_nickname text, p_game_user_id text, p_fallback text)
returns text
language sql
immutable
set search_path = public
as $$
  select left(coalesce(
    nullif(trim(p_nickname), ''),
    case when p_game_user_id is not null then 'Jugador ' || p_game_user_id end,
    nullif(trim(p_fallback), ''),
    'Jugador'
  ), 40);
$$;

-- ---------------------------------------------------------------------------
-- handle_new_user — sin display_name en el registro: sale del nick.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gid  text := trim(coalesce(new.raw_user_meta_data ->> 'game_user_id', ''));
  v_zone text := trim(coalesce(new.raw_user_meta_data ->> 'zone_id', ''));
  c      mlbb_account_cache;
begin
  if v_gid !~ '^[0-9]{5,12}$' or v_zone !~ '^[0-9]{3,6}$' then
    v_gid := null;
    v_zone := null;
  else
    c := cached_game_account(v_gid, v_zone);
  end if;

  insert into public.profiles (id, display_name, game_user_id, zone_id,
                               mlbb_nickname, mlbb_status, mlbb_checked_at)
  values (
    new.id,
    -- display_name de los metadatos solo lo usa scripts/create-admin.mjs.
    profile_display_name(c.nickname, v_gid,
      coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))),
    v_gid,
    v_zone,
    c.nickname,
    case when v_gid is null then null else coalesce(c.status, 'pending') end,
    c.checked_at
  );
  return new;
exception
  when unique_violation then
    raise exception 'Ese ID de jugador ya está registrado en otra cuenta';
end;
$$;

-- Cada vez que cambia el nick verificado, el nombre visible lo sigue.
create or replace function public.sync_profile_display_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.mlbb_nickname is distinct from old.mlbb_nickname
     or new.game_user_id is distinct from old.game_user_id then
    new.display_name := profile_display_name(new.mlbb_nickname, new.game_user_id, old.display_name);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_display_name on profiles;
create trigger profiles_sync_display_name
  before update on profiles
  for each row execute function public.sync_profile_display_name();

-- El nombre visible ya no lo edita el usuario.
revoke update on profiles from anon, authenticated;

-- ---------------------------------------------------------------------------
-- upsert_saved_team — igual que en 0008, pero el jugador 1 tiene que ser el ID
-- de la cuenta que arma el equipo.
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
  v_team    saved_teams;
  v_id      uuid;
  v_size    smallint := case p_mode when '1v1' then 1 when '3v3' then 3 else 5 end;
  v_profile profiles;
begin
  select * into v_profile from profiles where id = auth.uid();
  if not found then
    raise exception 'Necesitas iniciar sesión';
  end if;
  if v_profile.game_user_id is null then
    raise exception 'Registra tu ID de jugador en Mi perfil antes de armar un equipo';
  end if;
  if jsonb_typeof(p_members) <> 'array' or jsonb_array_length(p_members) <> v_size then
    raise exception 'El modo % necesita % jugadores', p_mode, v_size;
  end if;
  if (select array_agg((m->>'slot')::int order by (m->>'slot')::int)
        from jsonb_array_elements(p_members) m)
     is distinct from
     (select array_agg(g order by g) from generate_series(1, v_size) g) then
    raise exception 'Los jugadores deben ocupar los puestos 1 a %', v_size;
  end if;
  if not exists (select 1 from jsonb_array_elements(p_members) m
                  where (m->>'slot')::int = 1
                    and m->>'gameUserId' = v_profile.game_user_id
                    and m->>'zoneId' = v_profile.zone_id) then
    raise exception 'El capitán (jugador 1) es siempre tu propio ID de jugador';
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
      raise exception 'Hay un ID repetido en el roster (recuerda que tú ya eres el jugador 1)';
    else
      raise;
    end if;
  when check_violation then
    raise exception 'Revisa los datos: nombre de 2 a 40 caracteres, tag hasta 6, IDs y zonas numéricos';
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke execute on function public.profile_display_name(text, text, text) from public, anon, authenticated;
revoke execute on function public.sync_profile_display_name()           from public, anon, authenticated;
revoke execute on function public.handle_new_user()                      from public, anon, authenticated;
revoke execute on function public.upsert_saved_team(uuid, text, text, tournament_mode, jsonb) from public, anon;
grant  execute on function public.upsert_saved_team(uuid, text, text, tournament_mode, jsonb) to authenticated;

-- Las cuentas que ya tienen nick toman su nombre de él.
update profiles
   set display_name = profile_display_name(mlbb_nickname, game_user_id, display_name)
 where game_user_id is not null;
