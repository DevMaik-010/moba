-- ===========================================================================
-- 0007 — nadie sin sesión ejecuta funciones security definer
--
-- Postgres concede EXECUTE a PUBLIC en cada función nueva, así que el rol
-- `anon` podía llamar por /rest/v1/rpc a todas las RPC. Ninguna era explotable
-- (cada una comprueba is_admin() o auth.uid() por dentro), pero la defensa no
-- debería depender solo de eso. El advisor de Supabase lo marca como
-- `anon_security_definer_function_executable`.
--
-- Quedan para `authenticated` las que la app llama con sesión. La única
-- abierta a `anon` es get_match_room: con el código, un jugador sin cuenta ve
-- la sala de su partido.
-- ===========================================================================

-- Lo que la app llama con sesión: fuera PUBLIC/anon, se mantiene authenticated.
revoke execute on function public.set_user_role(uuid, app_role)                              from public, anon;
revoke execute on function public.open_tournament(uuid)                                      from public, anon;
revoke execute on function public.register_team(uuid)                                        from public, anon;
revoke execute on function public.lock_tournament(uuid)                                      from public, anon;
revoke execute on function public.start_tournament(uuid)                                     from public, anon;
revoke execute on function public.report_match(uuid, smallint, smallint)                     from public, anon;
revoke execute on function public.resolve_member_validation(uuid, validation_status, text)   from public, anon;
revoke execute on function public.update_tournament(uuid, text, text, timestamptz, tournament_mode, smallint) from public, anon;
revoke execute on function public.cancel_tournament(uuid)                                    from public, anon;
revoke execute on function public.delete_tournament(uuid)                                    from public, anon;
revoke execute on function public.remove_team(uuid)                                          from public, anon;
revoke execute on function public.upsert_saved_team(uuid, text, text, tournament_mode, jsonb) from public, anon;
revoke execute on function public.register_saved_team(uuid, uuid)                            from public, anon;
revoke execute on function public.set_tournament_archived(uuid, boolean)                     from public, anon;

-- is_admin() la usan las políticas RLS, que se evalúan con el rol de quien
-- consulta; anon lee torneos y partidos públicos, así que la necesita.
revoke execute on function public.is_admin(uuid) from public;
grant  execute on function public.is_admin(uuid) to anon, authenticated;

-- Función de trigger: se dispara sola al crear un usuario, nadie la llama.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
