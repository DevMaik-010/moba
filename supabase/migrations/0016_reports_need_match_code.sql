-- ===========================================================================
-- 0016 — solo quien está dentro de la sala reporta ese enfrentamiento
--
-- Antes cualquier usuario con sesión podía reportar a cualquier equipo de
-- cualquier torneo. Ahora un reporte va siempre ligado a un enfrentamiento y
-- exige el código de inscripción de uno de sus dos equipos (el mismo que abre
-- la sala). El admin no lo necesita. Solo se puede reportar a esos dos equipos.
-- ===========================================================================

drop function if exists public.create_report(uuid, uuid, uuid, text, report_reason, text, text);

create or replace function public.create_report(
  p_tournament_id uuid,
  p_match_id      uuid,
  p_team_id       uuid,
  p_player        text,
  p_reason        report_reason,
  p_description   text,
  p_evidence_path text,
  p_code          text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m        matches;
  v_desc   text := trim(coalesce(p_description, ''));
  v_player text := nullif(left(trim(coalesce(p_player, '')), 60), '');
  v_code   text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_path   text;
  v_id     uuid;
begin
  if auth.uid() is null then
    raise exception 'Necesitas iniciar sesión para reportar';
  end if;

  select * into m from matches where id = p_match_id and tournament_id = p_tournament_id;
  if not found or m.team_a_id is null or m.team_b_id is null then
    raise exception 'Los reportes se hacen desde la sala del enfrentamiento';
  end if;

  if not is_admin() and not exists (
    select 1 from team_access_codes
     where team_id in (m.team_a_id, m.team_b_id) and code = v_code and v_code <> ''
  ) then
    raise exception 'Solo los equipos de este enfrentamiento pueden reportarlo: entra con el código de tu equipo';
  end if;

  if p_team_id is not null and p_team_id not in (m.team_a_id, m.team_b_id) then
    raise exception 'Solo puedes reportar a un equipo de este enfrentamiento';
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
  values (auth.uid(), 'create_report', 'report', v_id,
          jsonb_build_object('reason', p_reason, 'match_id', p_match_id));

  return v_id;
end;
$$;

revoke execute on function public.create_report(uuid, uuid, uuid, text, report_reason, text, text, text) from public, anon;
grant  execute on function public.create_report(uuid, uuid, uuid, text, report_reason, text, text, text) to authenticated;
