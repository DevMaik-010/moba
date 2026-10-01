-- ===========================================================================
-- 0010 — ID de jugador por cuenta y una sola inscripción activa por capitán
--
-- ID de jugador en la cuenta
-- --------------------------
-- Cada cuenta registra su ID de juego y servidor (zona) de MLBB. Un mismo ID
-- solo puede pertenecer a una cuenta. El estado de verificación sale de
-- `mlbb_account_cache`, que solo escribe el servidor y el admin: ni el
-- formulario de registro ni el usuario lo pueden fijar. Si el verificador no
-- respondió, la cuenta queda `pending` y entra a la cola del admin.
--
-- Con el ID en revisión, rechazado o sin registrar (cuentas anteriores a esta
-- migración) se puede navegar y armar equipos, pero no inscribirse.
-- El ID de la cuenta es independiente del roster: el capitán de un equipo
-- puede ser cualquier ID.
--
-- Una inscripción activa
-- ----------------------
-- Un capitán solo puede estar inscrito en UN torneo vivo (abierto, cerrado o
-- en juego) a la vez. Cuando el torneo termina, se cancela o su equipo es
-- eliminado, puede inscribirse en otro.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Esquema
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists game_user_id    text;
alter table profiles add column if not exists zone_id         text;
alter table profiles add column if not exists mlbb_nickname   text;
alter table profiles add column if not exists mlbb_status     validation_status;
alter table profiles add column if not exists mlbb_checked_at timestamptz;

alter table profiles drop constraint if exists profiles_game_account_format;
alter table profiles add constraint profiles_game_account_format check (
  (game_user_id is null and zone_id is null and mlbb_status is null)
  or (game_user_id ~ '^[0-9]{5,12}$' and zone_id ~ '^[0-9]{3,6}$' and mlbb_status is not null)
);

-- Un ID de MLBB, una cuenta.
create unique index if not exists profiles_game_account_unique
  on profiles (game_user_id, zone_id) where game_user_id is not null;

create index if not exists profiles_mlbb_pending_idx
  on profiles (created_at) where mlbb_status = 'pending';

-- El usuario solo edita su nombre visible. Antes la política dejaba tocar
-- cualquier columna menos el rol, y ahora eso incluiría su propia
-- verificación. El ID se cambia por set_my_game_account; el resto, por RPC.
revoke update on profiles from anon, authenticated;
grant  update (display_name) on profiles to authenticated;

-- Consultas al verificador desde el registro, sin sesión todavía: el cupo va
-- por IP. Solo lo escribe y lee el servidor (service role).
create table if not exists mlbb_signup_lookup_log (
  id         bigserial primary key,
  ip         text not null,
  created_at timestamptz not null default now()
);
create index if not exists mlbb_signup_lookup_log_rate_idx
  on mlbb_signup_lookup_log (ip, created_at desc);
alter table mlbb_signup_lookup_log enable row level security;

-- ---------------------------------------------------------------------------
-- Veredicto actual de un ID según la caché (null = sin veredicto → pending).
-- ---------------------------------------------------------------------------
create or replace function public.cached_game_account(p_game_user_id text, p_zone_id text)
returns mlbb_account_cache
language sql
stable
security definer
set search_path = public
as $$
  select * from mlbb_account_cache
   where game_user_id = p_game_user_id and zone_id = p_zone_id and status <> 'pending';
$$;

-- ---------------------------------------------------------------------------
-- handle_new_user — el perfil nace con el ID que se mandó al registrarse.
-- El registro puede llegar directo a Supabase Auth sin pasar por la app, así
-- que un ID con formato inválido se ignora (la cuenta queda sin ID) y el
-- estado nunca se toma de los metadatos.
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
    left(trim(coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))), 40),
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

-- ---------------------------------------------------------------------------
-- set_my_game_account — registra o corrige el ID de la propia cuenta. Un ID
-- ya verificado queda fijo: cambiarlo es cosa del admin.
-- ---------------------------------------------------------------------------
create or replace function public.set_my_game_account(p_game_user_id text, p_zone_id text)
returns validation_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile profiles;
  v_gid     text := trim(coalesce(p_game_user_id, ''));
  v_zone    text := trim(coalesce(p_zone_id, ''));
  c         mlbb_account_cache;
  v_status  validation_status;
begin
  select * into v_profile from profiles where id = auth.uid() for update;
  if not found then
    raise exception 'Necesitas iniciar sesión';
  end if;
  if v_profile.mlbb_status in ('valid', 'manual_ok')
     and (v_profile.game_user_id is distinct from v_gid or v_profile.zone_id is distinct from v_zone) then
    raise exception 'Tu ID ya está verificado. Para cambiarlo, habla con un administrador';
  end if;
  if v_gid !~ '^[0-9]{5,12}$' then
    raise exception 'El ID de juego debe tener entre 5 y 12 dígitos';
  end if;
  if v_zone !~ '^[0-9]{3,6}$' then
    raise exception 'El ID de servidor (zona) debe tener entre 3 y 6 dígitos';
  end if;

  c := cached_game_account(v_gid, v_zone);
  v_status := coalesce(c.status, 'pending');

  update profiles
     set game_user_id    = v_gid,
         zone_id         = v_zone,
         mlbb_nickname   = c.nickname,
         mlbb_status     = v_status,
         mlbb_checked_at = c.checked_at
   where id = auth.uid();

  return v_status;
exception
  when unique_violation then
    raise exception 'Ese ID de jugador ya está registrado en otra cuenta';
end;
$$;

-- ---------------------------------------------------------------------------
-- resolve_profile_validation — el admin aprueba o rechaza el ID de una cuenta.
-- El veredicto se guarda en la caché y en los equipos guardados con ese ID,
-- igual que resolve_member_validation.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_profile_validation(
  p_profile_id uuid,
  p_status     validation_status,
  p_nickname   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p  profiles;
  v_nk text := nullif(left(trim(coalesce(p_nickname, '')), 40), '');
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede validar cuentas';
  end if;
  if p_status not in ('manual_ok', 'manual_rejected') then
    raise exception 'La resolución manual solo admite manual_ok o manual_rejected';
  end if;

  update profiles
     set mlbb_status = p_status,
         mlbb_nickname = coalesce(v_nk, mlbb_nickname),
         mlbb_checked_at = now()
   where id = p_profile_id and game_user_id is not null
  returning * into v_p;
  if not found then
    raise exception 'La cuenta no existe o no tiene ID de jugador';
  end if;

  insert into mlbb_account_cache (game_user_id, zone_id, nickname, status, provider, checked_at)
  values (v_p.game_user_id, v_p.zone_id, v_p.mlbb_nickname, p_status, 'admin', now())
  on conflict (game_user_id, zone_id) do update
    set status = excluded.status,
        nickname = coalesce(excluded.nickname, mlbb_account_cache.nickname),
        provider = 'admin',
        checked_at = now();

  update saved_team_members
     set validation_status = p_status,
         nickname = coalesce(v_nk, nickname),
         validated_at = now()
   where game_user_id = v_p.game_user_id and zone_id = v_p.zone_id;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'resolve_profile_validation', 'profile', p_profile_id,
          jsonb_build_object('status', p_status));
end;
$$;

-- ---------------------------------------------------------------------------
-- resolve_member_validation — igual que en 0005, y además alcanza a la cuenta
-- que tenga ese mismo ID, para no revisarlo dos veces.
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

    update profiles
       set mlbb_status = p_status,
           mlbb_nickname = coalesce(p_nickname, mlbb_nickname),
           mlbb_checked_at = now()
     where game_user_id = v_m.game_user_id and zone_id = v_m.zone_id;
  end if;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'resolve_member_validation', 'team_member', p_member_id,
          jsonb_build_object('status', p_status));
end;
$$;

-- ---------------------------------------------------------------------------
-- register_saved_team — igual que en 0005 + cuenta verificada + una sola
-- inscripción activa.
-- ---------------------------------------------------------------------------
create or replace function public.register_saved_team(p_saved_team_id uuid, p_tournament_id uuid)
returns table (seed smallint, match_id uuid, match_slot smallint, side match_side)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saved   saved_teams;
  v_t       tournaments;
  v_team    uuid;
  v_profile profiles;
  v_active  text;
begin
  select * into v_profile from profiles where id = auth.uid();
  if not found then
    raise exception 'Necesitas iniciar sesión';
  end if;
  if v_profile.game_user_id is null then
    raise exception 'Antes de inscribirte registra tu ID de jugador en Mi perfil';
  end if;
  if v_profile.mlbb_status in ('invalid', 'manual_rejected') then
    raise exception 'Tu ID de jugador fue rechazado. Corrígelo en Mi perfil';
  end if;
  if v_profile.mlbb_status not in ('valid', 'manual_ok') then
    raise exception 'Tu ID de jugador está en revisión. Podrás inscribirte cuando un administrador lo apruebe';
  end if;

  -- Serializa las inscripciones de un mismo capitán: sin esto, dos pestañas
  -- podrían inscribirlo a la vez en dos torneos distintos.
  perform pg_advisory_xact_lock(hashtext('register_saved_team:' || auth.uid()::text));

  select tr.name into v_active
    from teams t0
    join tournaments tr on tr.id = t0.tournament_id
   where t0.captain_id = auth.uid()
     and t0.seed is not null
     and t0.status = 'registered'
     and tr.status in ('open', 'locked', 'running')
     and tr.id <> p_tournament_id
   limit 1;
  if v_active is not null then
    raise exception 'Ya tienes una inscripción activa en "%". Podrás inscribirte en otro torneo cuando termine o tu equipo quede eliminado', v_active;
  end if;

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
  if exists (select 1 from teams t1
              where t1.tournament_id = p_tournament_id and t1.captain_id = auth.uid()
                and t1.status <> 'draft') then
    raise exception 'Ya tienes un equipo inscrito en este torneo';
  end if;

  delete from teams
   where tournament_id = p_tournament_id and captain_id = auth.uid() and status = 'draft';

  insert into teams (tournament_id, name, tag, captain_id, saved_team_id)
  values (p_tournament_id, v_saved.name, v_saved.tag, auth.uid(), v_saved.id)
  returning id into v_team;

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
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke execute on function public.cached_game_account(text, text) from public, anon, authenticated;
revoke execute on function public.handle_new_user()              from public, anon, authenticated;
revoke execute on function public.set_my_game_account(text, text) from public, anon;
revoke execute on function public.resolve_profile_validation(uuid, validation_status, text) from public, anon;
revoke execute on function public.resolve_member_validation(uuid, validation_status, text)  from public, anon;
revoke execute on function public.register_saved_team(uuid, uuid) from public, anon;

grant execute on function public.set_my_game_account(text, text) to authenticated;
grant execute on function public.resolve_profile_validation(uuid, validation_status, text) to authenticated;
grant execute on function public.resolve_member_validation(uuid, validation_status, text)  to authenticated;
grant execute on function public.register_saved_team(uuid, uuid) to authenticated;
