-- ===========================================================================
-- 0016 — rendimiento: índices y políticas RLS
--
-- Sin cambios de comportamiento: mismas filas visibles y mismos permisos.
--   * Índices para las claves foráneas sin cubrir (borrados en cascada de
--     torneos/equipos/perfiles y filtros de la app por tournament_id/captain_id).
--   * Fuera matches_tournament_idx: duplicaba la única (tournament_id, round, slot).
--   * Políticas: auth.uid() / is_admin() envueltos en (select ...) para que se
--     evalúen una vez por consulta y no por fila.
--   * Las políticas "admin ALL" pasan a INSERT/UPDATE/DELETE: la lectura del
--     admin ya la cubre la política de SELECT de cada tabla, así no se evalúan
--     dos políticas permisivas en cada SELECT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------
drop index if exists public.matches_tournament_idx;

create index if not exists matches_team_a_idx      on public.matches (team_a_id);
create index if not exists matches_team_b_idx      on public.matches (team_b_id);
create index if not exists matches_winner_idx      on public.matches (winner_id);
create index if not exists matches_next_match_idx  on public.matches (next_match_id);

-- mis-equipos / inscribir: teams.captain_id = uid order by created_at desc
create index if not exists teams_captain_idx on public.teams (captain_id, created_at desc);

create index if not exists match_rooms_tournament_idx       on public.match_rooms (tournament_id);
create index if not exists team_access_codes_tournament_idx on public.team_access_codes (tournament_id);
create index if not exists match_games_tournament_idx       on public.match_games (tournament_id, game_no);
create index if not exists match_games_claimed_by_idx       on public.match_games (claimed_by);
create index if not exists match_games_resolved_by_idx      on public.match_games (resolved_by);

create index if not exists reports_tournament_idx    on public.reports (tournament_id);
create index if not exists reports_match_idx         on public.reports (match_id);
create index if not exists reports_reported_team_idx on public.reports (reported_team_id);
create index if not exists reports_resolved_by_idx   on public.reports (resolved_by);

create index if not exists audit_log_actor_idx       on public.audit_log (actor_id);
create index if not exists tournaments_created_by_idx on public.tournaments (created_by);

-- Límite global de consultas de registro: count(*) where created_at >= since
create index if not exists mlbb_signup_lookup_log_recent_idx on public.mlbb_signup_lookup_log (created_at);

-- ---------------------------------------------------------------------------
-- Políticas RLS
-- ---------------------------------------------------------------------------

-- profiles
drop policy if exists profiles_admin_all on public.profiles;
drop policy if exists profiles_select_self_or_admin on public.profiles;
drop policy if exists profiles_update_self on public.profiles;

create policy profiles_select_self_or_admin on public.profiles
  for select using (id = (select auth.uid()) or (select is_admin()));
create policy profiles_update_self_or_admin on public.profiles
  for update
  using (id = (select auth.uid()) or (select is_admin()))
  with check (
    (select is_admin())
    or (id = (select auth.uid())
        and role = (select p.role from public.profiles p where p.id = (select auth.uid())))
  );
create policy profiles_admin_insert on public.profiles
  for insert to authenticated with check ((select is_admin()));
create policy profiles_admin_delete on public.profiles
  for delete to authenticated using ((select is_admin()));

-- tournaments
drop policy if exists tournaments_admin_write on public.tournaments;
drop policy if exists tournaments_public_read on public.tournaments;

create policy tournaments_public_read on public.tournaments
  for select using (status <> 'draft' or (select is_admin()));
create policy tournaments_admin_insert on public.tournaments
  for insert to authenticated with check ((select is_admin()));
create policy tournaments_admin_update on public.tournaments
  for update to authenticated using ((select is_admin())) with check ((select is_admin()));
create policy tournaments_admin_delete on public.tournaments
  for delete to authenticated using ((select is_admin()));

-- teams
drop policy if exists teams_admin_all on public.teams;
drop policy if exists teams_read on public.teams;

create policy teams_read on public.teams
  for select using (status <> 'draft' or captain_id = (select auth.uid()) or (select is_admin()));
create policy teams_admin_insert on public.teams
  for insert to authenticated with check ((select is_admin()));
create policy teams_admin_update on public.teams
  for update to authenticated using ((select is_admin())) with check ((select is_admin()));
create policy teams_admin_delete on public.teams
  for delete to authenticated using ((select is_admin()));

-- team_members
drop policy if exists team_members_admin_all on public.team_members;
drop policy if exists team_members_read on public.team_members;

create policy team_members_read on public.team_members
  for select using (
    exists (select 1 from public.teams t
             where t.id = team_members.team_id and t.captain_id = (select auth.uid()))
    or (select is_admin())
  );
create policy team_members_admin_insert on public.team_members
  for insert to authenticated with check ((select is_admin()));
create policy team_members_admin_update on public.team_members
  for update to authenticated using ((select is_admin())) with check ((select is_admin()));
create policy team_members_admin_delete on public.team_members
  for delete to authenticated using ((select is_admin()));

-- matches
drop policy if exists matches_admin_write on public.matches;

create policy matches_admin_insert on public.matches
  for insert to authenticated with check ((select is_admin()));
create policy matches_admin_update on public.matches
  for update to authenticated using ((select is_admin())) with check ((select is_admin()));
create policy matches_admin_delete on public.matches
  for delete to authenticated using ((select is_admin()));

-- saved_teams / saved_team_members
drop policy if exists saved_teams_owner_read on public.saved_teams;
drop policy if exists saved_teams_owner_delete on public.saved_teams;
drop policy if exists saved_team_members_owner_read on public.saved_team_members;

create policy saved_teams_owner_read on public.saved_teams
  for select using (owner_id = (select auth.uid()) or (select is_admin()));
create policy saved_teams_owner_delete on public.saved_teams
  for delete using (owner_id = (select auth.uid()));
create policy saved_team_members_owner_read on public.saved_team_members
  for select using (
    exists (select 1 from public.saved_teams s
             where s.id = saved_team_members.saved_team_id and s.owner_id = (select auth.uid()))
    or (select is_admin())
  );

-- team_access_codes
drop policy if exists team_access_codes_read on public.team_access_codes;

create policy team_access_codes_read on public.team_access_codes
  for select using (
    exists (select 1 from public.teams t
             where t.id = team_access_codes.team_id and t.captain_id = (select auth.uid()))
    or (select is_admin())
  );

-- reports / mlbb_lookup_log
drop policy if exists reports_read on public.reports;
drop policy if exists mlbb_log_own on public.mlbb_lookup_log;

create policy reports_read on public.reports
  for select using (reporter_id = (select auth.uid()) or (select is_admin()));
create policy mlbb_log_own on public.mlbb_lookup_log
  for select using (profile_id = (select auth.uid()) or (select is_admin()));

-- Solo-admin de lectura
drop policy if exists audit_log_admin_read on public.audit_log;
drop policy if exists match_games_admin_read on public.match_games;
drop policy if exists match_rooms_admin_read on public.match_rooms;
drop policy if exists mlbb_cache_admin_read on public.mlbb_account_cache;

create policy audit_log_admin_read on public.audit_log
  for select using ((select is_admin()));
create policy match_games_admin_read on public.match_games
  for select using ((select is_admin()));
create policy match_rooms_admin_read on public.match_rooms
  for select using ((select is_admin()));
create policy mlbb_cache_admin_read on public.mlbb_account_cache
  for select using ((select is_admin()));
