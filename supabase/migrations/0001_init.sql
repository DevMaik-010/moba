-- Plataforma de torneos MLBB — esquema inicial
-- Aplicar con el MCP de Supabase o pegando en el SQL Editor del panel.

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type app_role          as enum ('admin', 'user');
create type tournament_mode   as enum ('1v1', '3v3', '5v5');
create type tournament_status as enum ('draft', 'open', 'locked', 'running', 'finished', 'cancelled');
create type team_status       as enum ('draft', 'registered', 'rejected', 'eliminated');
create type match_status      as enum ('pending', 'ready', 'live', 'done', 'bye');
create type validation_status as enum ('pending', 'valid', 'invalid', 'manual_ok', 'manual_rejected');
create type match_side        as enum ('a', 'b');

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         app_role not null default 'user',
  display_name text not null default '',
  created_at   timestamptz not null default now()
);

-- El perfil nace junto con el usuario de auth.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- security definer: salta RLS, así que consultarla dentro de una policy de
-- `profiles` no provoca recursión infinita.
create function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = uid and role = 'admin');
$$;

-- ---------------------------------------------------------------------------
-- Caché y bitácora de validación de cuentas MLBB
-- ---------------------------------------------------------------------------
create table mlbb_account_cache (
  game_user_id text not null,
  zone_id      text not null,
  nickname     text,
  status       validation_status not null,
  provider     text not null,
  raw          jsonb,
  checked_at   timestamptz not null default now(),
  primary key (game_user_id, zone_id)
);

create table mlbb_lookup_log (
  id           bigserial primary key,
  profile_id   uuid not null references profiles (id) on delete cascade,
  game_user_id text not null,
  zone_id      text not null,
  created_at   timestamptz not null default now()
);

create index mlbb_lookup_log_rate_idx on mlbb_lookup_log (profile_id, created_at desc);

-- ---------------------------------------------------------------------------
-- tournaments
-- ---------------------------------------------------------------------------
create table tournaments (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) between 3 and 80),
  slug         text not null unique,
  mode         tournament_mode not null,
  team_size    smallint not null,
  bracket_size smallint not null check (bracket_size in (2, 4, 8, 16, 32, 64)),
  status       tournament_status not null default 'draft',
  rules        text not null default '',
  starts_at    timestamptz,
  created_by   uuid not null references profiles (id),
  created_at   timestamptz not null default now(),
  constraint team_size_matches_mode check (
    (mode = '1v1' and team_size = 1) or
    (mode = '3v3' and team_size = 3) or
    (mode = '5v5' and team_size = 5)
  )
);

create index tournaments_status_idx on tournaments (status, starts_at);

-- ---------------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------------
create table teams (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id) on delete cascade,
  name          text not null check (length(trim(name)) between 2 and 40),
  tag           text not null default '',
  captain_id    uuid not null references profiles (id) on delete cascade,
  status        team_status not null default 'draft',
  seed          smallint,
  created_at    timestamptz not null default now()
);

create unique index teams_name_per_tournament   on teams (tournament_id, lower(name));
create unique index teams_seed_per_tournament   on teams (tournament_id, seed) where seed is not null;
-- Un capitán, un equipo por torneo.
create unique index teams_captain_per_tournament on teams (tournament_id, captain_id);

-- ---------------------------------------------------------------------------
-- team_members
-- ---------------------------------------------------------------------------
create table team_members (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null references teams (id) on delete cascade,
  -- Denormalizado desde teams para poder imponer el índice único de abajo.
  tournament_id     uuid not null references tournaments (id) on delete cascade,
  slot              smallint not null check (slot >= 1),
  game_user_id      text not null check (game_user_id ~ '^[0-9]{5,12}$'),
  zone_id           text not null check (zone_id ~ '^[0-9]{3,6}$'),
  nickname          text,
  is_captain        boolean not null default false,
  validation_status validation_status not null default 'pending',
  validated_at      timestamptz,
  unique (team_id, slot)
);

-- Un mismo jugador no puede aparecer en dos equipos del mismo torneo.
create unique index team_members_unique_player
  on team_members (tournament_id, game_user_id, zone_id);

create index team_members_pending_idx
  on team_members (validation_status) where validation_status = 'pending';

-- ---------------------------------------------------------------------------
-- matches
-- ---------------------------------------------------------------------------
create table matches (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments (id) on delete cascade,
  round         smallint not null check (round >= 1),
  slot          smallint not null check (slot >= 1),
  team_a_id     uuid references teams (id) on delete set null,
  team_b_id     uuid references teams (id) on delete set null,
  winner_id     uuid references teams (id) on delete set null,
  score_a       smallint not null default 0 check (score_a >= 0),
  score_b       smallint not null default 0 check (score_b >= 0),
  status        match_status not null default 'pending',
  next_match_id uuid references matches (id) on delete set null,
  next_side     match_side,
  scheduled_at  timestamptz,
  updated_at    timestamptz not null default now(),
  unique (tournament_id, round, slot)
);

create index matches_tournament_idx on matches (tournament_id, round, slot);

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
create table audit_log (
  id         bigserial primary key,
  actor_id   uuid references profiles (id) on delete set null,
  action     text not null,
  entity     text,
  entity_id  uuid,
  detail     jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_recent_idx on audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table profiles           enable row level security;
alter table mlbb_account_cache enable row level security;
alter table mlbb_lookup_log    enable row level security;
alter table tournaments        enable row level security;
alter table teams              enable row level security;
alter table team_members       enable row level security;
alter table matches            enable row level security;
alter table audit_log          enable row level security;

-- profiles ------------------------------------------------------------------
create policy profiles_select_self_or_admin on profiles
  for select using (id = auth.uid() or is_admin());

-- El usuario edita su nombre, nunca su rol: el WITH CHECK compara contra la
-- fila ya guardada, así que cualquier intento de auto-promoverse falla.
create policy profiles_update_self on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select p.role from profiles p where p.id = auth.uid()));

create policy profiles_admin_all on profiles
  for all using (is_admin()) with check (is_admin());

-- mlbb_account_cache --------------------------------------------------------
-- Solo se escribe desde el servidor (service role, que ignora RLS).
create policy mlbb_cache_read_authenticated on mlbb_account_cache
  for select to authenticated using (true);

-- mlbb_lookup_log -----------------------------------------------------------
create policy mlbb_log_own on mlbb_lookup_log
  for select using (profile_id = auth.uid() or is_admin());

-- tournaments ---------------------------------------------------------------
create policy tournaments_public_read on tournaments
  for select using (status <> 'draft' or is_admin());

create policy tournaments_admin_write on tournaments
  for all using (is_admin()) with check (is_admin());

-- teams ---------------------------------------------------------------------
-- Los equipos en borrador solo los ve su capitán; los inscritos, todos.
create policy teams_read on teams
  for select using (status <> 'draft' or captain_id = auth.uid() or is_admin());

create policy teams_captain_insert on teams
  for insert to authenticated
  with check (
    captain_id = auth.uid()
    and exists (select 1 from tournaments t where t.id = tournament_id and t.status = 'open')
  );

-- Una vez inscrito, el roster se congela.
create policy teams_captain_update_draft on teams
  for update using (captain_id = auth.uid() and status = 'draft')
  with check (captain_id = auth.uid() and status = 'draft');

create policy teams_captain_delete_draft on teams
  for delete using (captain_id = auth.uid() and status = 'draft');

create policy teams_admin_all on teams
  for all using (is_admin()) with check (is_admin());

-- team_members --------------------------------------------------------------
create policy team_members_read on team_members
  for select using (
    exists (
      select 1 from teams t
      where t.id = team_id and (t.status <> 'draft' or t.captain_id = auth.uid())
    )
    or is_admin()
  );

create policy team_members_captain_write on team_members
  for all to authenticated
  using (
    exists (select 1 from teams t where t.id = team_id and t.captain_id = auth.uid() and t.status = 'draft')
  )
  with check (
    exists (select 1 from teams t where t.id = team_id and t.captain_id = auth.uid() and t.status = 'draft')
  );

create policy team_members_admin_all on team_members
  for all using (is_admin()) with check (is_admin());

-- matches -------------------------------------------------------------------
-- El cuadro es público: se lee sin sesión.
create policy matches_public_read on matches for select using (true);

create policy matches_admin_write on matches
  for all using (is_admin()) with check (is_admin());

-- audit_log -----------------------------------------------------------------
create policy audit_log_admin_read on audit_log for select using (is_admin());

-- ---------------------------------------------------------------------------
-- Realtime: el cuadro se apila solo en todas las pantallas abiertas.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table matches;
alter publication supabase_realtime add table teams;
