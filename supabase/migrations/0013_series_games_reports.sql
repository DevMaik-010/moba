-- ===========================================================================
-- 0013 — series al mejor de N, partidas con captura y reportes
--
-- Series
-- ------
-- Cada enfrentamiento es al mejor de 3; la final (el partido sin siguiente) al
-- mejor de 5. El marcador de la serie vive en matches.score_a / score_b, que
-- es público y viaja por Realtime: el cuadro muestra quién va ganando.
--
-- Partidas (match_games)
-- ----------------------
--   1. El capitán sorteado publica el ID de sala → nace la partida 1.
--   2. Cada partida tiene 5 minutos de preparación. Si los dos capitanes marcan
--      "listos" antes, empieza en ese momento; si no, al cumplirse los 5 min.
--   3. Ya empezada, el capitán ganador reporta la victoria con una captura de
--      pantalla (bucket privado `match-evidence`).
--   4. El capitán rival la confirma (queda registrada sin pasar por el admin)
--      o la disputa; el admin verifica con la captura y decide.
--   5. Al resolverse una partida suma al marcador; si alguien llegó a las
--      victorias necesarias el ganador avanza, si no nace la partida siguiente
--      con su propio tiempo de preparación.
--
-- Los reportes de resultado de 0006 (match_rooms.claim_*) quedan reemplazados.
--
-- Reportes de conducta (reports)
-- ------------------------------
-- Cualquier usuario con sesión denuncia a un equipo o jugador de un torneo por
-- incumplir las reglas, con evidencia opcional. Los lee su autor y el admin.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Formato de la serie
-- ---------------------------------------------------------------------------
create or replace function public.match_best_of(p_match matches)
returns smallint
language sql
stable
set search_path = public
as $$
  select (case when p_match.next_match_id is null then 5 else 3 end)::smallint;
$$;

-- ---------------------------------------------------------------------------
-- Partidas
-- ---------------------------------------------------------------------------
create table if not exists match_games (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references matches (id) on delete cascade,
  tournament_id   uuid not null references tournaments (id) on delete cascade,
  game_no         smallint not null check (game_no between 1 and 5),
  prep_started_at timestamptz not null default now(),
  ready_a_at      timestamptz,
  ready_b_at      timestamptz,
  claim_side      match_side,
  claimed_by      uuid references profiles (id) on delete set null,
  claimed_at      timestamptz,
  screenshot_path text check (screenshot_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'),
  disputed_at     timestamptz,
  dispute_note    text,
  winner_side     match_side,
  resolved_via    text check (resolved_via in ('rival', 'admin')),
  resolved_by     uuid references profiles (id) on delete set null,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (match_id, game_no)
);

create index if not exists match_games_open_claims_idx
  on match_games (tournament_id) where claim_side is not null and resolved_at is null;

alter table match_games enable row level security;

drop policy if exists match_games_admin_read on match_games;
create policy match_games_admin_read on match_games for select using (is_admin());

-- Cuándo empieza (o empezó) la partida: al estar los dos listos o a los 5 min.
create or replace function public.match_game_starts_at(g match_games)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select case
    when g.ready_a_at is not null and g.ready_b_at is not null
      then least(greatest(g.ready_a_at, g.ready_b_at), g.prep_started_at + interval '5 minutes')
    else g.prep_started_at + interval '5 minutes'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Los reportes de resultado de 0006 se van: ahora van por partida.
-- ---------------------------------------------------------------------------
drop function if exists public.claim_match_win(uuid, smallint, smallint);
drop function if exists public.dispute_match_claim(uuid, text);
drop function if exists public.confirm_match_claim(uuid);
drop function if exists public.reject_match_claim(uuid);

drop index if exists match_rooms_open_claims_idx;
alter table match_rooms
  drop column if exists claim_side,
  drop column if exists claim_score_a,
  drop column if exists claim_score_b,
  drop column if exists claimed_by,
  drop column if exists claimed_at,
  drop column if exists disputed_at,
  drop column if exists dispute_note;

-- ---------------------------------------------------------------------------
-- Evidencias: bucket privado. Cada usuario sube a su carpeta; el resto las ve
-- con URLs firmadas que genera el servidor tras comprobar el acceso.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('match-evidence', 'match-evidence', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists match_evidence_owner_read   on storage.objects;
drop policy if exists match_evidence_owner_insert on storage.objects;

create policy match_evidence_owner_read on storage.objects
  for select to authenticated
  using (bucket_id = 'match-evidence'
         and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));

create policy match_evidence_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'match-evidence' and (storage.foldername(name))[1] = auth.uid()::text);

-- La ruta tiene que ser del usuario y el archivo tiene que existir.
create or replace function public.check_evidence_path(p_path text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_path text := trim(coalesce(p_path, ''));
begin
  if v_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'
     or split_part(v_path, '/', 1) <> auth.uid()::text then
    raise exception 'Captura inválida';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'match-evidence' and name = v_path) then
    raise exception 'La captura no se subió; inténtalo de nuevo';
  end if;
  return v_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- sync_match_room — igual que en 0006, y además borra las partidas si el
-- partido vuelve a 'pending'.
-- ---------------------------------------------------------------------------
create or replace function public.sync_match_room()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'ready' and new.team_a_id is not null and new.team_b_id is not null then
      if new.host_side is null then
        new.host_side := case when random() < 0.5 then 'a' else 'b' end;
      end if;
      insert into match_rooms (match_id, tournament_id, code_a, code_b)
      values (new.id, new.tournament_id, gen_match_code(), gen_match_code())
      on conflict (match_id) do nothing;
    elsif new.status = 'pending' then
      new.host_side := null;
      new.score_a := 0;
      new.score_b := 0;
      delete from match_games where match_id = new.id;
      delete from match_rooms where match_id = new.id;
    elsif new.status = 'done' then
      update match_rooms set resolved_at = coalesce(resolved_at, now()) where match_id = new.id;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_game_result — helper interno: cierra la partida, recalcula la serie y
-- avanza al ganador o abre la partida siguiente.
-- ---------------------------------------------------------------------------
create or replace function public.apply_game_result(p_game_id uuid, p_winner match_side, p_via text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g      match_games;
  m      matches;
  v_need int;
  v_a    int;
  v_b    int;
begin
  select * into g from match_games where id = p_game_id for update;
  select * into m from matches where id = g.match_id for update;

  update match_games
     set winner_side = p_winner, resolved_via = p_via,
         resolved_by = auth.uid(), resolved_at = now()
   where id = p_game_id;

  select count(*) filter (where winner_side = 'a'), count(*) filter (where winner_side = 'b')
    into v_a, v_b
    from match_games where match_id = m.id;

  v_need := match_best_of(m) / 2 + 1;
  update matches set score_a = v_a, score_b = v_b, updated_at = now() where id = m.id;

  if greatest(v_a, v_b) >= v_need then
    perform apply_match_winner(m.id, case when v_a > v_b then m.team_a_id else m.team_b_id end, 'done');
    if m.next_match_id is null then
      update tournaments set status = 'finished' where id = m.tournament_id;
    end if;
  else
    insert into match_games (match_id, tournament_id, game_no)
    values (m.id, m.tournament_id, g.game_no + 1);
  end if;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'resolve_match_game', 'match', m.id,
          jsonb_build_object('game_no', g.game_no, 'winner', p_winner, 'via', p_via,
                             'score_a', v_a, 'score_b', v_b));
end;
$$;

-- ---------------------------------------------------------------------------
-- Validaciones comunes de las acciones de capitán sobre la partida en curso.
-- Devuelve el lado del capitán y deja bloqueados partido y partida.
-- ---------------------------------------------------------------------------
create or replace function public.lock_current_game(p_match_id uuid, out o_match matches, out o_game match_games, out o_side match_side)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t tournament_status;
begin
  select * into o_match from matches where id = p_match_id for update;
  if not found then
    raise exception 'Partido inexistente';
  end if;

  o_side := match_captain_side(o_match);
  if o_side is null then
    raise exception 'Solo los capitanes de este partido pueden hacer esto';
  end if;

  select status into v_t from tournaments where id = o_match.tournament_id;
  if v_t <> 'running' then
    raise exception 'El torneo no está en juego';
  end if;
  if o_match.status <> 'live' then
    raise exception 'Primero tiene que publicarse el ID de sala';
  end if;

  select * into o_game from match_games
   where match_id = p_match_id and resolved_at is null
   order by game_no desc limit 1
   for update;
  if not found then
    raise exception 'No hay ninguna partida en curso';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- post_match_room — el capitán sorteado publica (o cambia entre partidas) el
-- ID de sala. La primera publicación abre la partida 1.
-- ---------------------------------------------------------------------------
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
  if exists (select 1 from match_games
              where match_id = p_match_id and resolved_at is null and claim_side is not null) then
    raise exception 'Hay una partida reportada sin resolver; la sala no se puede cambiar ahora';
  end if;
  if v_id !~ '^[A-Za-z0-9-]{3,32}$' then
    raise exception 'El ID de sala debe tener de 3 a 32 letras, números o guiones';
  end if;

  update match_rooms set room_id = v_id, room_posted_at = now() where match_id = p_match_id;

  insert into match_games (match_id, tournament_id, game_no)
  select p_match_id, m.tournament_id, 1
   where not exists (select 1 from match_games where match_id = p_match_id);

  update matches set status = 'live', updated_at = now() where id = p_match_id;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'post_match_room', 'match', p_match_id, jsonb_build_object('room_id', v_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_game_ready — el capitán avisa que su equipo ya está listo. Con los dos
-- listos la partida empieza sin esperar a los 5 minutos.
-- ---------------------------------------------------------------------------
create or replace function public.mark_game_ready(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  select * into c from lock_current_game(p_match_id);
  if now() >= match_game_starts_at(c.o_game) then
    raise exception 'La partida % ya empezó', (c.o_game).game_no;
  end if;

  update match_games
     set ready_a_at = case when c.o_side = 'a' then coalesce(ready_a_at, now()) else ready_a_at end,
         ready_b_at = case when c.o_side = 'b' then coalesce(ready_b_at, now()) else ready_b_at end
   where id = (c.o_game).id;

  update matches set updated_at = now() where id = p_match_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_game_win — el capitán ganador reporta la partida en curso con su
-- captura de pantalla.
-- ---------------------------------------------------------------------------
create or replace function public.claim_game_win(p_match_id uuid, p_screenshot_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c      record;
  v_path text;
begin
  select * into c from lock_current_game(p_match_id);
  if (c.o_game).claim_side is not null then
    raise exception 'La partida % ya tiene un resultado reportado', (c.o_game).game_no;
  end if;
  if now() < match_game_starts_at(c.o_game) then
    raise exception 'La partida % todavía está en preparación', (c.o_game).game_no;
  end if;

  v_path := check_evidence_path(p_screenshot_path);

  update match_games
     set claim_side = c.o_side, claimed_by = auth.uid(), claimed_at = now(),
         screenshot_path = v_path, disputed_at = null, dispute_note = null
   where id = (c.o_game).id;

  update matches set updated_at = now() where id = p_match_id;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'claim_game_win', 'match', p_match_id,
          jsonb_build_object('game_no', (c.o_game).game_no, 'side', c.o_side));
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_game_claim / dispute_game_claim — la respuesta del capitán rival.
-- Confirmar registra la partida sin pasar por el admin.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_game_claim(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  select * into c from lock_current_game(p_match_id);
  if (c.o_game).claim_side is null then
    raise exception 'No hay ningún resultado que confirmar';
  end if;
  if (c.o_game).claim_side = c.o_side then
    raise exception 'Solo el capitán rival puede confirmar el resultado';
  end if;

  perform apply_game_result((c.o_game).id, (c.o_game).claim_side, 'rival');
end;
$$;

create or replace function public.dispute_game_claim(p_match_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c      record;
  v_note text := left(trim(coalesce(p_note, '')), 500);
begin
  select * into c from lock_current_game(p_match_id);
  if (c.o_game).claim_side is null then
    raise exception 'No hay ningún resultado que disputar';
  end if;
  if (c.o_game).claim_side = c.o_side then
    raise exception 'Solo el capitán rival puede disputar el resultado';
  end if;
  if length(v_note) < 5 then
    raise exception 'Cuenta brevemente qué pasó';
  end if;

  update match_games set disputed_at = now(), dispute_note = v_note where id = (c.o_game).id;
  update matches set updated_at = now() where id = p_match_id;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'dispute_game_claim', 'match', p_match_id,
          jsonb_build_object('game_no', (c.o_game).game_no));
end;
$$;

-- ---------------------------------------------------------------------------
-- resolve_game / reject_game_claim — la verificación del admin. Puede dar la
-- partida a cualquiera de los dos (también sin reporte, p. ej. por no
-- presentarse) o descartar el reporte para que se vuelva a reportar.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_game(p_game_id uuid, p_winner match_side)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g   match_games;
  m   matches;
  v_t tournament_status;
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede resolver partidas';
  end if;
  if p_winner is null then
    raise exception 'Indica el ganador';
  end if;

  select * into g from match_games where id = p_game_id for update;
  if not found or g.resolved_at is not null then
    raise exception 'Esa partida ya está resuelta';
  end if;
  select * into m from matches where id = g.match_id;
  select status into v_t from tournaments where id = m.tournament_id;
  if v_t <> 'running' or m.status <> 'live' then
    raise exception 'El partido no está en juego';
  end if;

  perform apply_game_result(p_game_id, p_winner, 'admin');
end;
$$;

create or replace function public.reject_game_claim(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g match_games;
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede rechazar resultados';
  end if;

  select * into g from match_games where id = p_game_id for update;
  if not found or g.resolved_at is not null or g.claim_side is null then
    raise exception 'No hay ningún resultado pendiente en esa partida';
  end if;

  update match_games
     set claim_side = null, claimed_by = null, claimed_at = null,
         screenshot_path = null, disputed_at = null, dispute_note = null
   where id = p_game_id;

  update matches set updated_at = now() where id = g.match_id;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'reject_game_claim', 'match', g.match_id,
          jsonb_build_object('game_no', g.game_no, 'side', g.claim_side));
end;
$$;

-- ---------------------------------------------------------------------------
-- report_match — el admin fija la serie completa a mano. Ahora exige un
-- marcador posible en el formato (Bo3: 2–0 o 2–1; Bo5: 3–x).
-- ---------------------------------------------------------------------------
create or replace function public.report_match(p_match_id uuid, p_score_a smallint, p_score_b smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m      matches;
  v_t    tournaments;
  v_win  uuid;
  v_need int;
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede reportar resultados';
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

  v_need := match_best_of(m) / 2 + 1;
  if p_score_a is null or p_score_b is null
     or greatest(p_score_a, p_score_b) <> v_need or least(p_score_a, p_score_b) < 0
     or least(p_score_a, p_score_b) >= v_need then
    raise exception 'Al mejor de %, gana quien llega a % victorias', match_best_of(m), v_need;
  end if;

  select * into v_t from tournaments where id = m.tournament_id;
  if v_t.status <> 'running' then
    raise exception 'El torneo no está en juego (estado: %)', v_t.status;
  end if;

  v_win := case when p_score_a > p_score_b then m.team_a_id else m.team_b_id end;

  update matches set score_a = p_score_a, score_b = p_score_b where id = p_match_id;
  perform apply_match_winner(p_match_id, v_win, 'done');

  if m.next_match_id is null then
    update tournaments set status = 'finished' where id = m.tournament_id;
  end if;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'report_match', 'match', p_match_id,
          jsonb_build_object('score_a', p_score_a, 'score_b', p_score_b, 'winner', v_win));
end;
$$;

-- ---------------------------------------------------------------------------
-- get_match_room — agrega formato de la serie y sus partidas.
-- ---------------------------------------------------------------------------
drop function if exists public.get_match_room(uuid, text);
create function public.get_match_room(p_match_id uuid, p_code text default null)
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
    'viewer', v_viewer,
    'captain_side', v_cap,
    'server_now', now(),
    'games', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id,
        'game_no', g.game_no,
        'winner_side', g.winner_side,
        'resolved_via', g.resolved_via,
        'resolved_at', g.resolved_at,
        'prep_started_at', g.prep_started_at,
        'starts_at', match_game_starts_at(g),
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

-- ---------------------------------------------------------------------------
-- Reportes de conducta
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'report_reason') then
    create type report_reason as enum
      ('no_show', 'cheating', 'toxicity', 'account_sharing', 'false_result', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'report_status') then
    create type report_status as enum ('open', 'reviewing', 'resolved', 'dismissed');
  end if;
end;
$$;

create table if not exists reports (
  id               uuid primary key default gen_random_uuid(),
  tournament_id    uuid not null references tournaments (id) on delete cascade,
  match_id         uuid references matches (id) on delete set null,
  reporter_id      uuid not null references profiles (id) on delete cascade,
  reported_team_id uuid references teams (id) on delete set null,
  reported_player  text check (length(reported_player) <= 60),
  reason           report_reason not null,
  description      text not null check (length(description) between 10 and 2000),
  evidence_path    text check (evidence_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'),
  status           report_status not null default 'open',
  admin_note       text check (length(admin_note) <= 1000),
  resolved_by      uuid references profiles (id) on delete set null,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists reports_status_idx   on reports (status, created_at desc);
create index if not exists reports_reporter_idx on reports (reporter_id, created_at desc);

alter table reports enable row level security;

drop policy if exists reports_read on reports;
create policy reports_read on reports
  for select using (reporter_id = auth.uid() or is_admin());

create or replace function public.create_report(
  p_tournament_id uuid,
  p_match_id      uuid,
  p_team_id       uuid,
  p_player        text,
  p_reason        report_reason,
  p_description   text,
  p_evidence_path text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_desc   text := trim(coalesce(p_description, ''));
  v_player text := nullif(left(trim(coalesce(p_player, '')), 60), '');
  v_path   text;
  v_id     uuid;
begin
  if auth.uid() is null then
    raise exception 'Necesitas iniciar sesión para reportar';
  end if;
  if not exists (select 1 from tournaments where id = p_tournament_id and status <> 'draft') then
    raise exception 'Torneo inexistente';
  end if;
  if p_match_id is not null
     and not exists (select 1 from matches where id = p_match_id and tournament_id = p_tournament_id) then
    raise exception 'Ese partido no es de este torneo';
  end if;
  if p_team_id is not null
     and not exists (select 1 from teams where id = p_team_id and tournament_id = p_tournament_id
                                           and seed is not null) then
    raise exception 'Ese equipo no juega este torneo';
  end if;
  if p_team_id is null and v_player is null then
    raise exception 'Indica el equipo o el jugador que reportas';
  end if;
  if p_reason is null then
    raise exception 'Elige el motivo';
  end if;
  if length(v_desc) < 10 then
    raise exception 'Describe lo que pasó (mínimo 10 caracteres)';
  end if;
  if (select count(*) from reports
       where reporter_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Llegaste al límite de reportes por hoy';
  end if;

  if nullif(trim(coalesce(p_evidence_path, '')), '') is not null then
    v_path := check_evidence_path(p_evidence_path);
  end if;

  insert into reports (tournament_id, match_id, reporter_id, reported_team_id, reported_player,
                       reason, description, evidence_path)
  values (p_tournament_id, p_match_id, auth.uid(), p_team_id, v_player,
          p_reason, left(v_desc, 2000), v_path)
  returning id into v_id;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'create_report', 'report', v_id, jsonb_build_object('reason', p_reason));

  return v_id;
end;
$$;

create or replace function public.resolve_report(p_report_id uuid, p_status report_status, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede resolver reportes';
  end if;
  if p_status is null or p_status = 'open' then
    raise exception 'Estado inválido';
  end if;

  update reports
     set status      = p_status,
         admin_note  = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
         resolved_by = case when p_status in ('resolved', 'dismissed') then auth.uid() end,
         resolved_at = case when p_status in ('resolved', 'dismissed') then now() end
   where id = p_report_id;
  if not found then
    raise exception 'Reporte inexistente';
  end if;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'resolve_report', 'report', p_report_id, jsonb_build_object('status', p_status));
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke execute on function public.match_best_of(matches)                       from public, anon, authenticated;
revoke execute on function public.match_game_starts_at(match_games)            from public, anon, authenticated;
revoke execute on function public.check_evidence_path(text)                    from public, anon, authenticated;
revoke execute on function public.apply_game_result(uuid, match_side, text)    from public, anon, authenticated;
revoke execute on function public.lock_current_game(uuid)                      from public, anon, authenticated;
revoke execute on function public.sync_match_room()                            from public, anon, authenticated;

revoke execute on function public.post_match_room(uuid, text)                  from public, anon;
revoke execute on function public.mark_game_ready(uuid)                        from public, anon;
revoke execute on function public.claim_game_win(uuid, text)                   from public, anon;
revoke execute on function public.confirm_game_claim(uuid)                     from public, anon;
revoke execute on function public.dispute_game_claim(uuid, text)               from public, anon;
revoke execute on function public.resolve_game(uuid, match_side)               from public, anon;
revoke execute on function public.reject_game_claim(uuid)                      from public, anon;
revoke execute on function public.report_match(uuid, smallint, smallint)       from public, anon;
revoke execute on function public.create_report(uuid, uuid, uuid, text, report_reason, text, text) from public, anon;
revoke execute on function public.resolve_report(uuid, report_status, text)    from public, anon;
revoke execute on function public.get_match_room(uuid, text)                   from public;

grant execute on function public.post_match_room(uuid, text)                   to authenticated;
grant execute on function public.mark_game_ready(uuid)                         to authenticated;
grant execute on function public.claim_game_win(uuid, text)                    to authenticated;
grant execute on function public.confirm_game_claim(uuid)                      to authenticated;
grant execute on function public.dispute_game_claim(uuid, text)                to authenticated;
grant execute on function public.resolve_game(uuid, match_side)                to authenticated;
grant execute on function public.reject_game_claim(uuid)                       to authenticated;
grant execute on function public.report_match(uuid, smallint, smallint)        to authenticated;
grant execute on function public.create_report(uuid, uuid, uuid, text, report_reason, text, text) to authenticated;
grant execute on function public.resolve_report(uuid, report_status, text)     to authenticated;
-- Con el código, un jugador sin cuenta también entra a ver la sala.
grant execute on function public.get_match_room(uuid, text)                    to anon, authenticated;
