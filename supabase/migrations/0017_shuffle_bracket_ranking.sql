-- ===========================================================================
-- 0017 — resorteo del cuadro y ranking de campeones
--
-- shuffle_bracket
-- ---------------
-- El admin puede volver a sortear los cruces mientras el torneo no haya
-- empezado (inscripciones abiertas o cerradas). Los equipos se reparten al azar
-- entre los MISMOS cupos ocupados, así que la forma del cuadro (cuántos byes y
-- dónde) no cambia: solo cambia quién va en cada cupo. Si el torneo ya estaba
-- cerrado, los byes se vuelven a resolver con lock_tournament_core.
-- Los códigos de inscripción de cada equipo no cambian.
--
-- team_ranking
-- ------------
-- Ranking histórico de equipos campeones. Un equipo se identifica por su
-- equipo guardado (el mismo equipo en varios torneos suma); las inscripciones
-- anteriores a 0005 cuentan por su cuenta. Solo entran torneos finalizados.
-- ===========================================================================

create or replace function public.shuffle_bracket(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t     tournaments;
  v_ids   uuid[];
  v_seeds smallint[];
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede resortear el cuadro';
  end if;

  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'Torneo inexistente';
  end if;
  if v_t.status not in ('open', 'locked') then
    raise exception 'Solo se resortea antes de iniciar el torneo (estado: %)', v_t.status;
  end if;

  if exists (
    select 1 from match_games
     where tournament_id = p_tournament_id
       and (winner_side is not null or claim_side is not null)
  ) then
    raise exception 'Ya hay partidas reportadas: no se puede resortear';
  end if;

  select array_agg(id order by random()), array_agg(seed order by seed)
    into v_ids, v_seeds
    from teams
   where tournament_id = p_tournament_id and seed is not null;

  if coalesce(array_length(v_ids, 1), 0) < 2 then
    raise exception 'Hacen falta al menos 2 equipos inscritos';
  end if;

  -- Dos pasos: el índice único de seed se comprueba fila a fila.
  update teams set seed = null where id = any (v_ids);
  update teams t
     set seed = s.seed
    from unnest(v_ids, v_seeds) as s (id, seed)
   where t.id = s.id;

  -- Cuadro en blanco. El trigger sync_match_room borra salas y partidas de los
  -- enfrentamientos que vuelven a 'pending'.
  update matches
     set team_a_id  = null,
         team_b_id  = null,
         winner_id  = null,
         status     = 'pending',
         score_a    = 0,
         score_b    = 0,
         host_side  = null,
         updated_at = now()
   where tournament_id = p_tournament_id;

  update matches m
     set team_a_id = t.id
    from teams t
   where t.tournament_id = p_tournament_id and t.seed is not null and t.seed % 2 = 1
     and m.tournament_id = p_tournament_id and m.round = 1 and m.slot = (t.seed + 1) / 2;

  update matches m
     set team_b_id = t.id
    from teams t
   where t.tournament_id = p_tournament_id and t.seed is not null and t.seed % 2 = 0
     and m.tournament_id = p_tournament_id and m.round = 1 and m.slot = t.seed / 2;

  update matches
     set status = 'ready', updated_at = now()
   where tournament_id = p_tournament_id and round = 1
     and team_a_id is not null and team_b_id is not null;

  -- Cerrado: se reabre un instante para volver a resolver los byes.
  if v_t.status = 'locked' then
    update tournaments set status = 'open' where id = p_tournament_id;
    perform lock_tournament_core(p_tournament_id);
  end if;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'shuffle_bracket', 'tournament', p_tournament_id,
          jsonb_build_object('teams', array_length(v_ids, 1), 'status', v_t.status));
end;
$$;

revoke execute on function public.shuffle_bracket(uuid) from public, anon;
grant  execute on function public.shuffle_bracket(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- team_ranking — campeones ordenados por títulos, finales y victorias.
-- ---------------------------------------------------------------------------
create or replace function public.team_ranking()
returns table (
  team_key        uuid,
  name            text,
  tag             text,
  logo_path       text,
  titles          int,
  finals          int,
  wins            int,
  losses          int,
  tournaments     int,
  last_title_at   timestamptz,
  last_title_name text,
  last_title_slug text
)
language sql
stable
security definer
set search_path = public
as $$
  with entries as (
    -- Cada inscripción en un torneo finalizado, con la clave del equipo.
    select t.id, coalesce(t.saved_team_id, t.id) as team_key, t.tournament_id,
           t.name, t.tag, t.logo_path, t.created_at
      from teams t
      join tournaments tr on tr.id = t.tournament_id
     where tr.status = 'finished' and t.seed is not null
  ),
  played as (
    -- Enfrentamientos jugados de verdad (sin byes).
    select m.*, (m.next_match_id is null) as is_final
      from matches m
      join tournaments tr on tr.id = m.tournament_id
     where tr.status = 'finished' and m.status = 'done'
       and m.team_a_id is not null and m.team_b_id is not null
  ),
  stats as (
    select e.team_key,
           count(distinct e.tournament_id)::int                                        as tournaments,
           count(p.id) filter (where p.winner_id = e.id)::int                          as wins,
           count(p.id) filter (where p.winner_id <> e.id)::int                         as losses,
           count(p.id) filter (where p.is_final)::int                                  as finals,
           count(p.id) filter (where p.is_final and p.winner_id = e.id)::int           as titles
      from entries e
      left join played p on e.id in (p.team_a_id, p.team_b_id)
     group by e.team_key
  ),
  latest as (
    -- Nombre y logo de la inscripción más reciente del equipo.
    select distinct on (team_key) team_key, name, tag, logo_path
      from entries
     order by team_key, created_at desc
  ),
  last_title as (
    select distinct on (e.team_key) e.team_key, p.updated_at, tr.name, tr.slug
      from entries e
      join played p on p.is_final and p.winner_id = e.id
      join tournaments tr on tr.id = e.tournament_id
     order by e.team_key, p.updated_at desc
  )
  select s.team_key, l.name, l.tag, l.logo_path,
         s.titles, s.finals, s.wins, s.losses, s.tournaments,
         lt.updated_at, lt.name, lt.slug
    from stats s
    join latest l using (team_key)
    left join last_title lt using (team_key)
   where s.titles > 0
   order by s.titles desc, s.finals desc, s.wins desc, s.losses asc, lt.updated_at asc;
$$;

grant execute on function public.team_ranking() to anon, authenticated;
