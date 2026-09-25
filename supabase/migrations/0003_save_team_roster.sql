-- ===========================================================================
-- 0003 — save_team_roster
--
-- ESTO ES LO ÚNICO QUE FALTA EJECUTAR si ya aplicaste 0001_init.sql y
-- 0002_rpc.sql. Pégalo completo en el SQL Editor de Supabase y dale RUN.
-- Es idempotente: se puede correr dos veces sin romper nada.
--
-- Qué arregla
-- -----------
-- Que un mismo ID de MLBB no pueda estar en dos equipos del mismo torneo.
--
-- El índice único que lo impide ya existía desde 0001_init.sql:
--
--     create unique index team_members_unique_player
--       on team_members (tournament_id, game_user_id, zone_id);
--
-- El problema no era la restricción, era CÓMO guardaba el roster la app:
-- hacía DELETE de los team_members del capitán y después, en una llamada
-- aparte, el INSERT del roster nuevo. Si el INSERT chocaba con ese índice
-- (porque alguno de los IDs ya estaba en otro equipo), el DELETE ya estaba
-- confirmado y el capitán se quedaba con el equipo VACÍO: perdía el roster
-- anterior y encima veía un error.
--
-- Al meter los dos pasos dentro de una función, quedan en la misma
-- transacción: si algo falla, Postgres revierte la función entera y el roster
-- viejo sigue intacto. De paso, el error crudo de Postgres se traduce a algo
-- que el capitán pueda leer.
-- ===========================================================================

create or replace function public.save_team_roster(
  p_tournament_id uuid,
  p_name          text,
  p_tag           text,
  p_members       jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament tournaments;
  v_team_id    uuid;
  v_status     team_status;
  v_member     jsonb;
begin
  select * into v_tournament from tournaments where id = p_tournament_id;
  if not found then
    raise exception 'Torneo inexistente';
  end if;
  if v_tournament.status <> 'open' then
    raise exception 'Las inscripciones están cerradas';
  end if;

  -- Un capitán, un equipo por torneo: se reutiliza el borrador si ya existe.
  select id, status into v_team_id, v_status
    from teams
   where tournament_id = p_tournament_id and captain_id = auth.uid();

  -- Una vez inscrito, el roster se congela.
  if v_team_id is not null and v_status <> 'draft' then
    raise exception 'Tu equipo ya está inscrito y el roster quedó congelado';
  end if;

  if v_team_id is null then
    insert into teams (tournament_id, name, tag, captain_id)
    values (p_tournament_id, p_name, p_tag, auth.uid())
    returning id into v_team_id;
  else
    update teams set name = p_name, tag = p_tag where id = v_team_id;
    delete from team_members where team_id = v_team_id;
  end if;

  for v_member in select * from jsonb_array_elements(p_members)
  loop
    insert into team_members (
      team_id, tournament_id, slot, game_user_id, zone_id, nickname,
      is_captain, validation_status, validated_at
    ) values (
      v_team_id,
      p_tournament_id,
      (v_member->>'slot')::smallint,
      v_member->>'gameUserId',
      v_member->>'zoneId',
      v_member->>'nickname',
      (v_member->>'isCaptain')::boolean,
      (v_member->>'validationStatus')::validation_status,
      case when v_member->>'validationStatus' = 'pending' then null else now() end
    );
  end loop;

  return v_team_id;
exception
  -- El índice único salta sin importar el validation_status del otro equipo:
  -- un ID ya usado está ocupado aunque siga pendiente de revisión.
  when unique_violation then
    if sqlerrm like '%team_members_unique_player%' then
      raise exception 'Uno de los IDs ya está registrado en otro equipo de este torneo';
    elsif sqlerrm like '%teams_name_per_tournament%' then
      raise exception 'Ya hay un equipo con ese nombre en el torneo';
    elsif sqlerrm like '%teams_captain_per_tournament%' then
      raise exception 'Ya tienes un equipo en este torneo';
    else
      raise;
    end if;
end;
$$;

grant execute on function public.save_team_roster(uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Comprobación (opcional): debe devolver una fila.
-- ---------------------------------------------------------------------------
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname = 'save_team_roster';
