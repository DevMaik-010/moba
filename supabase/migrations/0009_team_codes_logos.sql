-- ===========================================================================
-- 0009 — código de inscripción por equipo y logos de equipo
--
-- Código de inscripción
-- ---------------------
-- Antes cada partido generaba dos códigos (match_rooms.code_a / code_b) recién
-- al quedar listo, y al capitán se le rellenaba solo. Ahora el código nace al
-- INSCRIBIRSE: uno por equipo y torneo, único en toda la plataforma, y es el
-- que se pide para entrar a la sala de cualquiera de sus enfrentamientos.
-- Vive en `team_access_codes` (no en `teams`, que es pública y viaja por
-- Realtime): lo leen su capitán y el admin.
--
-- match_rooms.code_a / code_b siguen generándose pero ya no dan acceso.
--
-- Logos
-- -----
-- Cada equipo guardado puede tener un logo en el bucket público `team-logos`,
-- bajo la carpeta del dueño (`<uid>/...`). Se guarda la RUTA, nunca una URL
-- libre, para que el cuadro solo muestre imágenes de nuestro bucket. Al
-- inscribirse, la ruta se copia a `teams`; cambiar el logo después actualiza
-- también las inscripciones de torneos que no han terminado.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Código de inscripción
-- ---------------------------------------------------------------------------
create table if not exists team_access_codes (
  team_id       uuid primary key references teams (id) on delete cascade,
  tournament_id uuid not null references tournaments (id) on delete cascade,
  code          text not null unique check (code ~ '^[A-Z2-9]{8}$'),
  created_at    timestamptz not null default now()
);

alter table team_access_codes enable row level security;

drop policy if exists team_access_codes_read on team_access_codes;
create policy team_access_codes_read on team_access_codes
  for select using (
    exists (select 1 from teams t where t.id = team_id and t.captain_id = auth.uid())
    or is_admin()
  );

-- 8 caracteres de un alfabeto de 32 sin los que se confunden (0/O, 1/I).
-- 256 es múltiplo de 32, así que cada byte aleatorio da un carácter uniforme.
-- Se saltan los bytes 6 y 8 del UUID v4: llevan bits fijos de versión/variante.
create or replace function public.gen_team_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes    bytea := uuid_send(gen_random_uuid());
  v_code     text := '';
  i          int;
begin
  foreach i in array array[0, 1, 2, 3, 4, 5, 9, 10] loop
    v_code := v_code || substr(v_alphabet, get_byte(v_bytes, i) % 32 + 1, 1);
  end loop;
  return v_code;
end;
$$;

-- El código nace cuando el equipo recibe su cupo (register_team), sea cual sea
-- el camino por el que se inscribió.
create or replace function public.issue_team_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_try int := 0;
begin
  if new.seed is not null and old.seed is null then
    loop
      begin
        insert into team_access_codes (team_id, tournament_id, code)
        values (new.id, new.tournament_id, gen_team_code())
        on conflict (team_id) do nothing;
        exit;
      exception when unique_violation then
        -- Choque de código (≈1 en un billón): se sortea otro.
        v_try := v_try + 1;
        if v_try >= 5 then
          raise;
        end if;
      end;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists teams_issue_code on teams;
create trigger teams_issue_code
  after update of seed on teams
  for each row execute function public.issue_team_code();

-- Inscripciones anteriores a esta migración.
insert into team_access_codes (team_id, tournament_id, code)
select id, tournament_id, gen_team_code()
  from teams
 where seed is not null
on conflict (team_id) do nothing;

-- ---------------------------------------------------------------------------
-- Logos
-- ---------------------------------------------------------------------------
alter table saved_teams add column if not exists logo_path text;
alter table teams       add column if not exists logo_path text;

alter table saved_teams drop constraint if exists saved_teams_logo_path_format;
alter table saved_teams add constraint saved_teams_logo_path_format
  check (logo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$');
alter table teams drop constraint if exists teams_logo_path_format;
alter table teams add constraint teams_logo_path_format
  check (logo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$');

-- Al inscribir, el equipo del torneo hereda el logo del equipo guardado.
create or replace function public.copy_saved_team_logo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.saved_team_id is not null and new.logo_path is null then
    select logo_path into new.logo_path from saved_teams where id = new.saved_team_id;
  end if;
  return new;
end;
$$;

drop trigger if exists teams_copy_logo on teams;
create trigger teams_copy_logo
  before insert on teams
  for each row execute function public.copy_saved_team_logo();

-- set_saved_team_logo — fija o quita (p_path null) el logo. Devuelve la ruta
-- anterior para que el servidor borre el archivo viejo del bucket.
create or replace function public.set_saved_team_logo(p_saved_team_id uuid, p_path text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team saved_teams;
begin
  select * into v_team from saved_teams where id = p_saved_team_id for update;
  if not found or v_team.owner_id is distinct from auth.uid() then
    raise exception 'Equipo inexistente';
  end if;
  if p_path is not null and split_part(p_path, '/', 1) <> auth.uid()::text then
    raise exception 'Ruta de logo inválida';
  end if;

  update saved_teams set logo_path = p_path, updated_at = now() where id = p_saved_team_id;

  -- Las inscripciones vivas muestran el logo nuevo; las de torneos cerrados
  -- conservan el que tenían.
  update teams t
     set logo_path = p_path
    from tournaments tr
   where t.saved_team_id = p_saved_team_id
     and tr.id = t.tournament_id
     and tr.status not in ('finished', 'cancelled');

  return v_team.logo_path;
end;
$$;

-- Bucket público de lectura; cada usuario escribe solo en su carpeta.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-logos', 'team-logos', true, 1048576,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists team_logos_owner_read   on storage.objects;
drop policy if exists team_logos_owner_insert on storage.objects;
drop policy if exists team_logos_owner_delete on storage.objects;

create policy team_logos_owner_read on storage.objects
  for select to authenticated
  using (bucket_id = 'team-logos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy team_logos_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'team-logos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy team_logos_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'team-logos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- get_match_room — ahora valida contra el código de inscripción de cada
-- equipo, devuelve los logos y ya no entrega el código al capitán: lo tiene
-- que escribir como cualquier jugador.
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

  if v_admin then
    v_viewer := 'admin';
  elsif r.match_id is not null and v_code <> '' then
    v_viewer := case when v_code = v_code_a then 'a' when v_code = v_code_b then 'b' end;
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
    'team_a', case when ta.id is null then null else jsonb_build_object(
      'id', ta.id, 'name', ta.name, 'tag', ta.tag, 'logo_path', ta.logo_path) end,
    'team_b', case when tb.id is null then null else jsonb_build_object(
      'id', tb.id, 'name', tb.name, 'tag', tb.tag, 'logo_path', tb.logo_path) end,
    'has_room', r.match_id is not null,
    'viewer', v_viewer,
    'captain_side', v_cap,
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
      'code_a', case when v_admin then v_code_a end,
      'code_b', case when v_admin then v_code_b end
    ) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke execute on function public.gen_team_code()          from public, anon, authenticated;
revoke execute on function public.issue_team_code()        from public, anon, authenticated;
revoke execute on function public.copy_saved_team_logo()   from public, anon, authenticated;
revoke execute on function public.set_saved_team_logo(uuid, text) from public, anon;
revoke execute on function public.get_match_room(uuid, text)      from public;

grant execute on function public.set_saved_team_logo(uuid, text) to authenticated;
-- Con el código, un jugador sin cuenta también entra a ver la sala.
grant execute on function public.get_match_room(uuid, text)      to anon, authenticated;
