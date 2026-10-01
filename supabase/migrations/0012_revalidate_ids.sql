-- ===========================================================================
-- 0012 — reintentar la verificación automática
--
-- Cuando el verificador no responde, el ID queda `pending`. Ahora se puede
-- volver a intentar:
--   * el dueño de un equipo, desde "Mis equipos" (solo los IDs de su equipo);
--   * el admin, desde Validaciones, antes de resolver a mano.
-- El servidor consulta al proveedor y escribe la caché; estas funciones solo
-- copian ese veredicto a las filas que siguen pendientes. Nunca pisan una
-- decisión manual del admin ni un veredicto ya dado.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- apply_cached_verdict — helper interno: lleva el veredicto de la caché a
-- todas las filas pendientes con ese ID (rosters guardados, inscripciones y
-- cuentas). Devuelve el veredicto, o null si la caché no tiene ninguno.
-- ---------------------------------------------------------------------------
create or replace function public.apply_cached_verdict(p_game_user_id text, p_zone_id text)
returns validation_status
language plpgsql
security definer
set search_path = public
as $$
declare
  c mlbb_account_cache;
begin
  c := cached_game_account(p_game_user_id, p_zone_id);
  if c.status is null then
    return null;
  end if;

  update saved_team_members
     set validation_status = c.status,
         nickname = coalesce(c.nickname, nickname),
         validated_at = c.checked_at
   where game_user_id = p_game_user_id and zone_id = p_zone_id
     and validation_status = 'pending';

  update team_members
     set validation_status = c.status,
         nickname = coalesce(c.nickname, nickname),
         validated_at = c.checked_at
   where game_user_id = p_game_user_id and zone_id = p_zone_id
     and validation_status = 'pending';

  -- El trigger de 0011 cambia el nombre visible al nick.
  update profiles
     set mlbb_status = c.status,
         mlbb_nickname = coalesce(c.nickname, mlbb_nickname),
         mlbb_checked_at = c.checked_at
   where game_user_id = p_game_user_id and zone_id = p_zone_id
     and mlbb_status = 'pending';

  return c.status;
end;
$$;

-- ---------------------------------------------------------------------------
-- refresh_saved_team_validation — el dueño reintenta su equipo. Devuelve
-- cuántos IDs siguen pendientes.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_saved_team_validation(p_saved_team_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team saved_teams;
  m      saved_team_members;
  v_left int;
begin
  select * into v_team from saved_teams where id = p_saved_team_id;
  if not found or v_team.owner_id is distinct from auth.uid() then
    raise exception 'Equipo inexistente';
  end if;

  for m in
    select * from saved_team_members
     where saved_team_id = p_saved_team_id and validation_status = 'pending'
  loop
    perform apply_cached_verdict(m.game_user_id, m.zone_id);
  end loop;

  select count(*) into v_left
    from saved_team_members
   where saved_team_id = p_saved_team_id and validation_status = 'pending';
  return v_left;
end;
$$;

-- ---------------------------------------------------------------------------
-- revalidate_game_account — el admin reintenta un ID de la cola.
-- ---------------------------------------------------------------------------
create or replace function public.revalidate_game_account(p_game_user_id text, p_zone_id text)
returns validation_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status validation_status;
begin
  if not is_admin() then
    raise exception 'Solo un administrador puede revalidar IDs';
  end if;

  v_status := apply_cached_verdict(p_game_user_id, p_zone_id);

  insert into audit_log (actor_id, action, entity, detail)
  values (auth.uid(), 'revalidate_game_account', 'mlbb_id',
          jsonb_build_object('game_user_id', p_game_user_id, 'zone_id', p_zone_id,
                             'status', coalesce(v_status::text, 'pending')));
  return coalesce(v_status, 'pending');
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke execute on function public.apply_cached_verdict(text, text)         from public, anon, authenticated;
revoke execute on function public.refresh_saved_team_validation(uuid)      from public, anon;
revoke execute on function public.revalidate_game_account(text, text)      from public, anon;
grant  execute on function public.refresh_saved_team_validation(uuid)      to authenticated;
grant  execute on function public.revalidate_game_account(text, text)      to authenticated;
