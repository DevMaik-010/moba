-- ===========================================================================
-- 0015 — la partida 1 vuelve a sortearse sola
--
-- Al quedar listo el enfrentamiento se sortea su anfitrión al momento, como
-- antes de 0014: el cuadro muestra la etiqueta SALA desde el principio. Solo la
-- partida decisiva espera a que los dos capitanes estén listos (ready_for_draw).
-- ===========================================================================

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

-- Los listos que 0014 dejó esperando el sorteo de la partida 1.
update matches
   set host_side = case when random() < 0.5 then 'a'::match_side else 'b'::match_side end
 where status = 'ready' and host_side is null
   and team_a_id is not null and team_b_id is not null;

update match_rooms r
   set draw_ready_a_at = null, draw_ready_b_at = null
  from matches m
 where m.id = r.match_id and m.status = 'ready';

revoke execute on function public.sync_match_room() from public, anon, authenticated;
