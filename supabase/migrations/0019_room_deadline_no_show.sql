-- ===========================================================================
-- 0019 — 5 minutos para publicar la sala; si no, el rival reclama la partida
--
-- El equipo que crea la sala tiene 5 minutos para publicar su ID:
--   * partida 1: desde que arranca el torneo (o desde que el enfrentamiento
--     queda listo, si el torneo ya estaba en juego) → match_rooms.room_due_at;
--   * siguientes: desde que se abre la partida o se sortea su anfitrión
--     (match_games.prep_started_at, que ya marcan open_next_game y ready_for_draw).
-- Vencido el plazo sin sala, el capitán rival reclama la victoria de esa
-- partida (claim_no_show) y queda registrada al momento (resolved_via
-- 'no_show'). Si la serie sigue, la partida siguiente vuelve a dar 5 minutos.
-- ===========================================================================

alter table match_rooms add column if not exists room_due_at timestamptz;

alter table match_games drop constraint if exists match_games_resolved_via_check;
alter table match_games add constraint match_games_resolved_via_check
  check (resolved_via in ('rival', 'admin', 'no_show'));

-- ---------------------------------------------------------------------------
-- Plazo de la partida actual: null si no corre (sala ya publicada, sorteo
-- pendiente o el enfrentamiento no está en juego).
-- ---------------------------------------------------------------------------
create or replace function public.match_room_deadline(p_match_id uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m matches;
  g match_games;
begin
  select * into m from matches where id = p_match_id;
  if not found or m.host_side is null then
    return null;
  end if;
  if m.status = 'ready' then
    return (select room_due_at from match_rooms where match_id = p_match_id and room_id is null);
  end if;
  if m.status <> 'live' then
    return null;
  end if;
  select * into g from match_games
   where match_id = p_match_id and resolved_at is null
   order by game_no desc limit 1;
  if not found or g.room_posted_at is not null or g.host_side is null then
    return null;
  end if;
  return g.prep_started_at + interval '5 minutes';
end;
$$;

-- Sala creada con el torneo ya en juego: el reloj de la partida 1 arranca ya.
create or replace function public.set_room_due_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.room_due_at is null
     and exists (select 1 from tournaments where id = new.tournament_id and status = 'running') then
    new.room_due_at := now() + interval '5 minutes';
  end if;
  return new;
end;
$$;

drop trigger if exists match_rooms_due_at on match_rooms;
create trigger match_rooms_due_at
  before insert on match_rooms
  for each row execute function public.set_room_due_at();

-- El torneo arranca: corre el reloj de todos los enfrentamientos listos.
create or replace function public.start_room_clocks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'running' and old.status is distinct from 'running' then
    update match_rooms r
       set room_due_at = now() + interval '5 minutes'
      from matches m
     where m.id = r.match_id and m.tournament_id = new.id
       and m.status = 'ready' and r.room_id is null;
  end if;
  return new;
end;
$$;

drop trigger if exists tournaments_room_clocks on tournaments;
create trigger tournaments_room_clocks
  after update of status on tournaments
  for each row execute function public.start_room_clocks();

-- Enfrentamientos que ya esperaban sala en torneos en juego.
update match_rooms r
   set room_due_at = now() + interval '5 minutes'
  from matches m, tournaments t
 where m.id = r.match_id and t.id = m.tournament_id
   and t.status = 'running' and m.status = 'ready'
   and r.room_id is null and r.room_due_at is null;

-- ---------------------------------------------------------------------------
-- El rival no publicó la sala a tiempo: la partida es para quien reclama.
-- ---------------------------------------------------------------------------
create or replace function public.claim_no_show(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m     matches;
  g     match_games;
  v_t   tournament_status;
  v_cap match_side;
  v_due timestamptz;
begin
  select * into m from matches where id = p_match_id for update;
  if not found then
    raise exception 'Partido inexistente';
  end if;

  v_cap := match_captain_side(m);
  if v_cap is null then
    raise exception 'Solo los capitanes de este partido pueden reclamar la victoria';
  end if;

  select status into v_t from tournaments where id = m.tournament_id;
  if v_t <> 'running' then
    raise exception 'El torneo no está en juego';
  end if;
  if m.status not in ('ready', 'live') then
    raise exception 'Este partido ya no admite reclamos';
  end if;
  if m.host_side is null then
    raise exception 'Primero se tiene que sortear quién crea la sala';
  end if;
  if m.host_side = v_cap then
    raise exception 'La sala la crea tu equipo: publícala';
  end if;

  v_due := match_room_deadline(p_match_id);
  if v_due is null then
    raise exception 'La sala ya se publicó';
  end if;
  if now() < v_due then
    raise exception 'El rival todavía tiene tiempo para publicar la sala';
  end if;

  if m.status = 'ready' then
    insert into match_games (match_id, tournament_id, game_no, host_side, host_drawn, prep_started_at)
    values (p_match_id, m.tournament_id, 1, m.host_side, true, v_due - interval '5 minutes')
    returning * into g;
    update matches set status = 'live', updated_at = now() where id = p_match_id;
  else
    select * into g from match_games
     where match_id = p_match_id and resolved_at is null
     order by game_no desc limit 1
     for update;
  end if;

  perform apply_game_result(g.id, v_cap, 'no_show');

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'claim_no_show', 'match', p_match_id,
          jsonb_build_object('game_no', g.game_no, 'winner', v_cap, 'due', v_due));
end;
$$;

-- ---------------------------------------------------------------------------
-- get_match_room — igual que en 0014, con el plazo para publicar la sala.
-- ---------------------------------------------------------------------------
create or replace function public.get_match_room(p_match_id uuid, p_code text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m        matches;
  r        match_rooms;
  t        tournaments;
  ta       teams;
  tb       teams;
  v_code_a text;
  v_code_b text;
  v_admin  boolean := is_admin();
  v_code   text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_viewer text;
  v_cap    match_side;
  v_bo     smallint;
begin
  select * into m from matches where id = p_match_id;
  if not found then
    return null;
  end if;

  select * into t  from tournaments where id = m.tournament_id;
  select * into ta from teams where id = m.team_a_id;
  select * into tb from teams where id = m.team_b_id;
  select * into r  from match_rooms where match_id = p_match_id;
  select code into v_code_a from team_access_codes where team_id = m.team_a_id;
  select code into v_code_b from team_access_codes where team_id = m.team_b_id;

  v_cap := match_captain_side(m);
  v_bo  := match_best_of(m);

  if v_admin then
    v_viewer := 'admin';
  elsif r.match_id is not null and v_code <> '' then
    v_viewer := case when v_code = v_code_a then 'a' when v_code = v_code_b then 'b' end;
  end if;

  return jsonb_build_object(
    'match', jsonb_build_object(
      'id', m.id, 'round', m.round, 'slot', m.slot, 'status', m.status,
      'score_a', m.score_a, 'score_b', m.score_b, 'winner_id', m.winner_id,
      'host_side', m.host_side, 'best_of', v_bo, 'wins_needed', v_bo / 2 + 1
    ),
    'tournament', jsonb_build_object(
      'id', t.id, 'name', t.name, 'slug', t.slug, 'status', t.status, 'mode', t.mode,
      'rounds', (select max(round) from matches where tournament_id = t.id)
    ),
    'team_a', case when ta.id is null then null else jsonb_build_object(
      'id', ta.id, 'name', ta.name, 'tag', ta.tag, 'logo_path', ta.logo_path) end,
    'team_b', case when tb.id is null then null else jsonb_build_object(
      'id', tb.id, 'name', tb.name, 'tag', tb.tag, 'logo_path', tb.logo_path) end,
    'has_room', r.match_id is not null,
    'draw', jsonb_build_object('ready_a', r.draw_ready_a_at is not null,
                               'ready_b', r.draw_ready_b_at is not null),
    'viewer', v_viewer,
    'captain_side', v_cap,
    'server_now', now(),
    'room_due_at', match_room_deadline(m.id),
    'games', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id,
        'game_no', g.game_no,
        'host_side', g.host_side,
        'host_drawn', g.host_drawn,
        'room_posted_at', g.room_posted_at,
        'winner_side', g.winner_side,
        'resolved_via', g.resolved_via,
        'resolved_at', g.resolved_at,
        'prep_started_at', g.prep_started_at,
        'starts_at', case when g.room_posted_at is not null then match_game_starts_at(g) end,
        'ready_a', g.ready_a_at is not null,
        'ready_b', g.ready_b_at is not null,
        'claim_side', g.claim_side,
        'claimed_at', g.claimed_at,
        'screenshot_path', case when v_viewer is not null then g.screenshot_path end,
        'disputed_at', g.disputed_at,
        'dispute_note', case when v_viewer is not null then g.dispute_note end
      ) order by g.game_no), '[]'::jsonb)
      from match_games g where g.match_id = m.id
    ),
    'room', case when v_viewer is null or r.match_id is null then null else jsonb_build_object(
      'room_id', r.room_id,
      'room_posted_at', r.room_posted_at,
      'resolved_at', r.resolved_at,
      'code_a', case when v_admin then v_code_a end,
      'code_b', case when v_admin then v_code_b end
    ) end
  );
end;
$$;

revoke execute on function public.match_room_deadline(uuid)  from public, anon, authenticated;
revoke execute on function public.set_room_due_at()          from public, anon, authenticated;
revoke execute on function public.start_room_clocks()        from public, anon, authenticated;
revoke execute on function public.claim_no_show(uuid)        from public, anon;
revoke execute on function public.get_match_room(uuid, text) from public;

grant execute on function public.claim_no_show(uuid)         to authenticated;
-- Con el código, un jugador sin cuenta también entra a ver la sala.
grant execute on function public.get_match_room(uuid, text)  to anon, authenticated;
