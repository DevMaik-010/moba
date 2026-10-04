-- ===========================================================================
-- 0020 — el admin programa la fecha de cada enfrentamiento
--
-- matches.scheduled_at existe desde 0001 pero nadie la usaba. Ahora el admin
-- la fija (o la borra) por enfrentamiento, p. ej. para mover la final a otro
-- día. El reloj de 5 minutos de la partida 1 (0019) no corre antes de esa hora.
-- ===========================================================================

create or replace function public.set_match_schedule(p_match_id uuid, p_scheduled_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m   matches;
  v_t tournament_status;
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede cambiar la fecha';
  end if;

  select * into m from matches where id = p_match_id for update;
  if not found then
    raise exception 'Partido inexistente';
  end if;
  if m.status in ('done', 'bye') then
    raise exception 'Este enfrentamiento ya terminó';
  end if;
  select status into v_t from tournaments where id = m.tournament_id;
  if v_t in ('finished', 'cancelled') then
    raise exception 'El torneo ya no está activo';
  end if;

  update matches set scheduled_at = p_scheduled_at, updated_at = now() where id = p_match_id;

  insert into audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'set_match_schedule', 'match', p_match_id,
          jsonb_build_object('scheduled_at', p_scheduled_at, 'prev', m.scheduled_at));
end;
$$;

revoke execute on function public.set_match_schedule(uuid, timestamptz) from public, anon;
grant execute on function public.set_match_schedule(uuid, timestamptz)  to authenticated;
