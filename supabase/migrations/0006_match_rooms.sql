-- ===========================================================================
-- 0006 — sala de cada enfrentamiento
--
-- Cuando un partido tiene a sus dos equipos:
--   * se generan dos códigos de acceso, uno por lado, para entrar a la sala del
--     enfrentamiento (el capitán lo ve y lo puede compartir con su equipo);
--   * se sortea qué capitán crea la sala en MLBB (`matches.host_side`, público:
--     el cuadro lo marca).
-- El capitán sorteado publica el ID de sala, el ganador reporta la victoria, el
-- rival puede disputarla y el admin confirma: recién entonces report_match
-- avanza al ganador.
--
-- Códigos, ID de sala y reportes viven en `match_rooms`, que NO es legible
-- desde el cliente (matches sí es público). Todo se lee por get_match_room.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Esquema
-- ---------------------------------------------------------------------------
alter table matches add column if not exists host_side match_side;

create table if not exists match_rooms (
  match_id       uuid primary key references matches (id) on delete cascade,
  tournament_id  uuid not null references tournaments (id) on delete cascade,
  code_a         text not null,
  code_b         text not null,
  room_id        text,
  room_posted_at timestamptz,
  claim_side     match_side,
  claim_score_a  smallint,
  claim_score_b  smallint,
  claimed_by     uuid references profiles (id) on delete set null,
  claimed_at     timestamptz,
  disputed_at    timestamptz,
  dispute_note   text,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists match_rooms_open_claims_idx
  on match_rooms (tournament_id) where claim_side is not null and resolved_at is null;

alter table match_rooms enable row level security;

-- Solo el admin lee la tabla directo; capitanes y jugadores pasan por RPC.
drop policy if exists match_rooms_admin_read on match_rooms;
create policy match_rooms_admin_read on match_rooms for select using (is_admin());

-- ---------------------------------------------------------------------------
-- Código de acceso: 8 caracteres hex de un UUID v4 (los 8 primeros son
-- aleatorios). ~4 mil millones de combinaciones por lado.
-- ---------------------------------------------------------------------------
create or replace function public.gen_match_code()
returns text
language sql
volatile
set search_path = public
as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
$$;

-- ---------------------------------------------------------------------------
-- Trigger: la sala nace cuando el partido pasa a 'ready' con sus dos equipos,
-- muere si vuelve a 'pending' (el admin quitó un equipo) y se da por resuelta
-- cuando el partido termina, venga de un reporte confirmado o del admin a mano.
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
      delete from match_rooms where match_id = new.id;
    elsif new.status = 'done' then
      update match_rooms set resolved_at = coalesce(resolved_at, now()) where match_id = new.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists matches_sync_room on matches;
create trigger matches_sync_room
  before update on matches
  for each row execute function public.sync_match_room();

-- Partidos que ya estaban listos antes de esta migración.
update matches
   set host_side = case when random() < 0.5 then 'a'::match_side else 'b'::match_side end
 where status in ('ready', 'live') and host_side is null
   and team_a_id is not null and team_b_id is not null;

insert into match_rooms (match_id, tournament_id, code_a, code_b)
select id, tournament_id, gen_match_code(), gen_match_code()
  from matches
 where status in ('ready', 'live') and team_a_id is not null and team_b_id is not null
on conflict (match_id) do nothing;

-- ---------------------------------------------------------------------------
-- Helpers internos
-- ---------------------------------------------------------------------------

-- Lado que capitanea el usuario actual en ese partido, o null.
create or replace function public.match_captain_side(p_match matches)
returns match_side
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then null
    when exists (select 1 from teams where id = p_match.team_a_id and captain_id = auth.uid()) then 'a'::match_side
    when exists (select 1 from teams where id = p_match.team_b_id and captain_id = auth.uid()) then 'b'::match_side
  end;
$$;

-- ---------------------------------------------------------------------------
-- get_match_room — lo que ve cada quien. Con el código de un lado (o siendo
-- admin) se ve la sala; sin él, solo los datos públicos del partido. Al capitán
-- se le devuelve además su propio código para que lo comparta.
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
  v_admin  boolean := is_admin();
  v_code   text := upper(trim(coalesce(p_code, '')));
  v_viewer text;
  v_cap    match_side;
begin
  select * into m from matches where id = p_match_id;
  if not found then
    return null;
  end if;

  select * into t  from tournaments where id = m.tournament_id;
  select * into ta from teams where id = m.team_a_id;
  select * into tb from teams where id = m.team_b_id;
  select * into r  from match_rooms where match_id = p_match_id;

  v_cap := match_captain_side(m);

  if v_admin then
    v_viewer := 'admin';
  elsif r.match_id is not null and v_code <> '' then
    v_viewer := case when v_code = r.code_a then 'a' when v_code = r.code_b then 'b' end;
  end if;

  return jsonb_build_object(
    'match', jsonb_build_object(
      'id', m.id, 'round', m.round, 'slot', m.slot, 'status', m.status,
      'score_a', m.score_a, 'score_b', m.score_b, 'winner_id', m.winner_id,
      'host_side', m.host_side
    ),
    'tournament', jsonb_build_object(
      'id', t.id, 'name', t.name, 'slug', t.slug, 'status', t.status, 'mode', t.mode,
      'rounds', (select max(round) from matches where tournament_id = t.id)
    ),
    'team_a', case when ta.id is null then null
                   else jsonb_build_object('id', ta.id, 'name', ta.name, 'tag', ta.tag) end,
    'team_b', case when tb.id is null then null
                   else jsonb_build_object('id', tb.id, 'name', tb.name, 'tag', tb.tag) end,
    'has_room', r.match_id is not null,
    'viewer', v_viewer,
    'captain_side', v_cap,
    'my_code', case v_cap when 'a' then r.code_a when 'b' then r.code_b end,
    'room', case when v_viewer is null or r.match_id is null then null else jsonb_build_object(
      'room_id', r.room_id,
      'room_posted_at', r.room_posted_at,
      'claim_side', r.claim_side,
      'claim_score_a', r.claim_score_a,
      'claim_score_b', r.claim_score_b,
      'claimed_at', r.claimed_at,
      'disputed_at', r.disputed_at,
      'dispute_note', r.dispute_note,
      'resolved_at', r.resolved_at,
      'code_a', case when v_admin then r.code_a end,
      'code_b', case when v_admin then r.code_b end
    ) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- post_match_room — el capitán sorteado publica (o corrige) el ID de sala.
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
  if v_cap <> m.host_side then
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
  -- 'live' en el cuadro público, y el cambio avisa por Realtime al rival.
  update matches set status = 'live', updated_at = now() where id = p_match_id;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'post_match_room', 'match', p_match_id, jsonb_build_object('room_id', v_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_match_win — el capitán ganador reporta la victoria con el marcador
-- visto desde su equipo. Queda pendiente hasta que el admin lo confirme.
-- ---------------------------------------------------------------------------
create or replace function public.claim_match_win(
  p_match_id    uuid,
  p_my_score    smallint,
  p_rival_score smallint
)
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
    raise exception 'Solo los capitanes de este partido pueden reportar el resultado';
  end if;

  select status into v_t from tournaments where id = m.tournament_id;
  if v_t <> 'running' then
    raise exception 'El torneo todavía no está en juego';
  end if;
  if m.status <> 'live' then
    raise exception 'Primero tiene que publicarse el ID de sala';
  end if;
  if r.claim_side is not null and r.resolved_at is null then
    raise exception 'Ya hay un resultado esperando la verificación del admin';
  end if;
  if p_my_score is null or p_rival_score is null or p_my_score < 0 or p_rival_score < 0
     or p_my_score > 99 or p_rival_score > 99 then
    raise exception 'Marcador inválido';
  end if;
  if p_my_score <= p_rival_score then
    raise exception 'Solo el equipo ganador reporta: tu marcador tiene que ser mayor';
  end if;

  update match_rooms
     set claim_side    = v_cap,
         claim_score_a = case when v_cap = 'a' then p_my_score else p_rival_score end,
         claim_score_b = case when v_cap = 'b' then p_my_score else p_rival_score end,
         claimed_by    = auth.uid(),
         claimed_at    = now(),
         disputed_at   = null,
         dispute_note  = null,
         resolved_at   = null
   where match_id = p_match_id;

  update matches set updated_at = now() where id = p_match_id;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'claim_match_win', 'match', p_match_id,
          jsonb_build_object('side', v_cap, 'my_score', p_my_score, 'rival_score', p_rival_score));
end;
$$;

-- ---------------------------------------------------------------------------
-- dispute_match_claim — el capitán rival no está de acuerdo con el reporte.
-- ---------------------------------------------------------------------------
create or replace function public.dispute_match_claim(p_match_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m     matches;
  r     match_rooms;
  v_cap match_side;
begin
  select * into m from matches where id = p_match_id;
  if not found then
    raise exception 'Partido inexistente';
  end if;
  select * into r from match_rooms where match_id = p_match_id for update;
  if not found or r.claim_side is null or r.resolved_at is not null then
    raise exception 'No hay ningún resultado pendiente que disputar';
  end if;

  v_cap := match_captain_side(m);
  if v_cap is null or v_cap = r.claim_side then
    raise exception 'Solo el capitán rival puede disputar el resultado';
  end if;

  update match_rooms
     set disputed_at = now(),
         dispute_note = left(trim(coalesce(p_note, '')), 500)
   where match_id = p_match_id;

  update matches set updated_at = now() where id = p_match_id;

  insert into audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'dispute_match_claim', 'match', p_match_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_match_claim / reject_match_claim — la verificación del admin.
-- Confirmar pasa por report_match, así que el ganador avanza igual que siempre
-- (y el trigger marca la sala como resuelta).
-- ---------------------------------------------------------------------------
create or replace function public.confirm_match_claim(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r match_rooms;
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede confirmar resultados';
  end if;

  select * into r from match_rooms where match_id = p_match_id for update;
  if not found or r.claim_side is null or r.resolved_at is not null then
    raise exception 'No hay ningún resultado pendiente en este partido';
  end if;

  perform report_match(p_match_id, r.claim_score_a, r.claim_score_b);

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'confirm_match_claim', 'match', p_match_id,
          jsonb_build_object('side', r.claim_side, 'disputed', r.disputed_at is not null));
end;
$$;

create or replace function public.reject_match_claim(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r match_rooms;
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede rechazar resultados';
  end if;

  select * into r from match_rooms where match_id = p_match_id for update;
  if not found or r.claim_side is null or r.resolved_at is not null then
    raise exception 'No hay ningún resultado pendiente en este partido';
  end if;

  update match_rooms
     set claim_side = null, claim_score_a = null, claim_score_b = null,
         claimed_by = null, claimed_at = null, disputed_at = null, dispute_note = null
   where match_id = p_match_id;

  update matches set updated_at = now() where id = p_match_id;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'reject_match_claim', 'match', p_match_id,
          jsonb_build_object('side', r.claim_side,
                             'score_a', r.claim_score_a, 'score_b', r.claim_score_b));
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución. Postgres da EXECUTE a PUBLIC por defecto: se quita en
-- los helpers internos y se concede explícito en lo que usa la app.
-- ---------------------------------------------------------------------------
revoke execute on function public.gen_match_code()               from public, anon, authenticated;
revoke execute on function public.sync_match_room()              from public, anon, authenticated;
revoke execute on function public.match_captain_side(matches)    from public, anon, authenticated;
revoke execute on function public.post_match_room(uuid, text)               from public, anon;
revoke execute on function public.claim_match_win(uuid, smallint, smallint) from public, anon;
revoke execute on function public.dispute_match_claim(uuid, text)           from public, anon;
revoke execute on function public.confirm_match_claim(uuid)                 from public, anon;
revoke execute on function public.reject_match_claim(uuid)                  from public, anon;

-- Con código, un jugador sin cuenta también entra a ver la sala.
grant execute on function public.get_match_room(uuid, text)                  to anon, authenticated;
grant execute on function public.post_match_room(uuid, text)                 to authenticated;
grant execute on function public.claim_match_win(uuid, smallint, smallint)   to authenticated;
grant execute on function public.dispute_match_claim(uuid, text)             to authenticated;
grant execute on function public.confirm_match_claim(uuid)                   to authenticated;
grant execute on function public.reject_match_claim(uuid)                    to authenticated;
