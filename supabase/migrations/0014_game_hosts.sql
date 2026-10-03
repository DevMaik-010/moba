-- ===========================================================================
-- 0014 — quién crea la sala en cada partida de la serie
--
-- La sala ya no la crea siempre el mismo capitán:
--   * Partida 1: sorteo.
--   * Partidas intermedias: se intercala (P2 el otro, P3 el de P1, …).
--   * Partida decisiva (P3 en Bo3, P5 en Bo5): nuevo sorteo.
--
-- Un sorteo no se hace solo: cada capitán pulsa "listo para el sorteo"
-- (match_rooms.draw_ready_*) y, con los dos, el servidor sortea. Así los dos
-- ven la animación a la vez. El admin puede forzarlo si un capitán no aparece.
-- Mientras tanto no hay anfitrión (host_side null) y nadie puede publicar sala.
--
-- Cada partida guarda su anfitrión (match_games.host_side) y si salió de un
-- sorteo (host_drawn, para que la sala muestre la animación). matches.host_side
-- pasa a ser el anfitrión de la partida ACTUAL: el cuadro, el admin y la página
-- del torneo lo siguen leyendo de ahí sin cambios.
--
-- Si cambia el anfitrión, la sala anterior deja de valer: el nuevo capitán
-- publica la suya y recién entonces corren los 5 minutos de preparación.
-- ===========================================================================

alter table match_games
  add column if not exists host_side      match_side,
  add column if not exists host_drawn     boolean not null default false,
  add column if not exists room_posted_at timestamptz;

alter table match_rooms
  add column if not exists draw_ready_a_at timestamptz,
  add column if not exists draw_ready_b_at timestamptz;

-- Enfrentamientos listos que todavía no publicaron sala: su anfitrión se había
-- sorteado solo al quedar listos; ahora lo sortean los capitanes.
update matches m
   set host_side = null
 where m.status = 'ready'
   and not exists (select 1 from match_games g where g.match_id = m.id);

-- Partidas que ya existían: se les reconstruye el anfitrión con la regla nueva
-- y se dan por publicadas (ya estaban corriendo con la sala de la serie).
update match_games g
   set host_side = case
         when g.game_no % 2 = 1 then m.host_side
         when m.host_side = 'a' then 'b'::match_side
         else 'a'::match_side
       end,
       host_drawn = g.game_no = 1,
       room_posted_at = coalesce(g.room_posted_at, g.prep_started_at)
  from matches m
 where m.id = g.match_id and g.host_side is null;

-- ---------------------------------------------------------------------------
-- Sin sala publicada la partida no empieza nunca: no corre la preparación ni
-- se puede reportar.
-- ---------------------------------------------------------------------------
create or replace function public.match_game_starts_at(g match_games)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select case
    when g.room_posted_at is null then 'infinity'::timestamptz
    when g.ready_a_at is not null and g.ready_b_at is not null
      then least(greatest(g.ready_a_at, g.ready_b_at), g.prep_started_at + interval '5 minutes')
    else g.prep_started_at + interval '5 minutes'
  end;
$$;

-- ---------------------------------------------------------------------------
-- sync_match_room — igual que en 0013, pero al quedar listo el enfrentamiento
-- ya no sortea el anfitrión: lo sortean los capitanes con ready_for_draw.
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
-- open_next_game — helper interno: abre la partida p_game_no con su anfitrión.
-- La decisiva nace sin anfitrión: espera el sorteo.
-- ---------------------------------------------------------------------------
create or replace function public.open_next_game(p_match_id uuid, p_game_no smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m        matches;
  v_first  match_side;
  v_host   match_side;
  v_drawn  boolean := false;
  v_keep   boolean;
begin
  select * into m from matches where id = p_match_id for update;
  select host_side into v_first from match_games where match_id = p_match_id and game_no = 1;
  v_first := coalesce(v_first, m.host_side);

  if p_game_no = match_best_of(m) then
    v_host := null;
    v_drawn := true;
  elsif p_game_no % 2 = 1 then
    v_host := v_first;
  else
    v_host := case when v_first = 'a' then 'b' else 'a' end;
  end if;

  -- Mismo anfitrión que la partida anterior: sigue la misma sala. Con sorteo
  -- pendiente la sala se guarda hasta saber a quién le toca (ready_for_draw).
  v_keep := coalesce(v_host = m.host_side, false);
  update match_rooms
     set room_id        = case when v_host is null or v_keep then room_id end,
         room_posted_at = case when v_host is null or v_keep then room_posted_at end,
         draw_ready_a_at = null,
         draw_ready_b_at = null
   where match_id = p_match_id;

  insert into match_games (match_id, tournament_id, game_no, host_side, host_drawn,
                           prep_started_at, room_posted_at)
  values (p_match_id, m.tournament_id, p_game_no, v_host, v_drawn,
          now(), case when v_keep then now() end);

  update matches set host_side = v_host, updated_at = now() where id = p_match_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_game_result — igual que en 0013, pero la partida siguiente nace con
-- su anfitrión.
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
    perform open_next_game(m.id, (g.game_no + 1)::smallint);
  end if;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'resolve_match_game', 'match', m.id,
          jsonb_build_object('game_no', g.game_no, 'winner', p_winner, 'via', p_via,
                             'score_a', v_a, 'score_b', v_b));
end;
$$;

-- ---------------------------------------------------------------------------
-- post_match_room — el anfitrión de la partida actual publica su sala. La
-- primera publicación abre la partida 1; en las siguientes, publicar arranca
-- la preparación de la partida que la esperaba.
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
  if m.host_side is null then
    raise exception 'Primero tienen que sortear quién crea la sala';
  end if;
  if v_cap is distinct from m.host_side then
    raise exception 'Esta partida la crea el capitán del otro equipo';
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
  values (auth.uid(), 'post_match_room', 'match', p_match_id, jsonb_build_object('room_id', v_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- ready_for_draw — el capitán avisa que está listo para el sorteo de la sala.
-- Con los dos listos (o si lo pide el admin) se sortea en el momento.
-- Devuelve el lado sorteado, o null si todavía falta el otro capitán.
-- ---------------------------------------------------------------------------
create or replace function public.ready_for_draw(p_match_id uuid)
returns match_side
language plpgsql
security definer
set search_path = public
as $$
declare
  m      matches;
  r      match_rooms;
  g      match_games;
  v_t    tournament_status;
  v_cap  match_side;
  v_host match_side;
  v_prev match_side;
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
  if v_cap is null and not is_admin() then
    raise exception 'Solo los capitanes de este partido pueden sortear la sala';
  end if;

  select status into v_t from tournaments where id = m.tournament_id;
  if v_t <> 'running' then
    raise exception 'El torneo todavía no está en juego';
  end if;

  -- ¿Qué sorteo está pendiente? El de la partida 1 o el de la decisiva.
  if m.status = 'ready' then
    if m.host_side is not null then
      raise exception 'El sorteo ya se hizo';
    end if;
  elsif m.status = 'live' then
    select * into g from match_games
     where match_id = p_match_id and resolved_at is null
     order by game_no desc limit 1
     for update;
    if not found or g.host_side is not null then
      raise exception 'No hay ningún sorteo pendiente';
    end if;
  else
    raise exception 'Este partido ya no admite sorteos';
  end if;

  if v_cap is not null then
    update match_rooms
       set draw_ready_a_at = case when v_cap = 'a' then coalesce(draw_ready_a_at, now()) else draw_ready_a_at end,
           draw_ready_b_at = case when v_cap = 'b' then coalesce(draw_ready_b_at, now()) else draw_ready_b_at end
     where match_id = p_match_id
    returning * into r;
  end if;

  -- Falta el otro capitán: se avisa por Realtime y se espera.
  if not is_admin() and (r.draw_ready_a_at is null or r.draw_ready_b_at is null) then
    update matches set updated_at = now() where id = p_match_id;
    return null;
  end if;

  v_host := case when random() < 0.5 then 'a' else 'b' end;
  update match_rooms set draw_ready_a_at = null, draw_ready_b_at = null where match_id = p_match_id;

  if g.id is not null then
    select host_side into v_prev from match_games
     where match_id = p_match_id and game_no = g.game_no - 1;
    if v_host is distinct from v_prev then
      update match_rooms set room_id = null, room_posted_at = null where match_id = p_match_id;
      r.room_id := null;
    end if;
    update match_games
       set host_side = v_host,
           -- Le vuelve a tocar al de la partida anterior: su sala sigue.
           room_posted_at = case when v_host = v_prev and r.room_id is not null then now() end,
           prep_started_at = now()
     where id = g.id;
  end if;

  update matches set host_side = v_host, updated_at = now() where id = p_match_id;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'draw_room_host', 'match', p_match_id,
          jsonb_build_object('host', v_host, 'game_no', coalesce(g.game_no, 1),
                             'forced', v_cap is null));
  return v_host;
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_game_ready — además, no se puede estar listo sin sala publicada.
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
  if (c.o_game).room_posted_at is null then
    raise exception 'Primero se tiene que publicar la sala de la partida %', (c.o_game).game_no;
  end if;
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
-- get_match_room — igual que en 0013, con el anfitrión de cada partida.
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
    'draw', jsonb_build_object('ready_a', r.draw_ready_a_at is not null,
                               'ready_b', r.draw_ready_b_at is not null),
    'viewer', v_viewer,
    'captain_side', v_cap,
    'server_now', now(),
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

-- ---------------------------------------------------------------------------
-- Endurecimiento: TRUNCATE no pasa por RLS, y TRIGGER/REFERENCES no los usa
-- nadie desde el cliente. Todo lo que escribe va por funciones.
-- ---------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t.tablename);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke execute on function public.match_game_starts_at(match_games)         from public, anon, authenticated;
revoke execute on function public.open_next_game(uuid, smallint)            from public, anon, authenticated;
revoke execute on function public.sync_match_room()                         from public, anon, authenticated;
revoke execute on function public.ready_for_draw(uuid)                      from public, anon;
revoke execute on function public.apply_game_result(uuid, match_side, text) from public, anon, authenticated;
revoke execute on function public.post_match_room(uuid, text)               from public, anon;
revoke execute on function public.mark_game_ready(uuid)                     from public, anon;
revoke execute on function public.get_match_room(uuid, text)                from public;

grant execute on function public.post_match_room(uuid, text)                to authenticated;
grant execute on function public.mark_game_ready(uuid)                      to authenticated;
grant execute on function public.ready_for_draw(uuid)                       to authenticated;
grant execute on function public.get_match_room(uuid, text)                 to anon, authenticated;
