import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { MatchBadge } from "@/components/ui/badge";
import { roundLabel } from "@/lib/bracket/bracket";
import { matchCodeCookie } from "@/lib/match-access";
import { createClient } from "@/lib/supabase/server";
import type { MatchSide, MatchRoomView } from "@/lib/db/types";
import {
  ClaimForm,
  CodeForm,
  CopyButton,
  DisputeForm,
  RoomIdForm,
  RoomLive,
} from "./match-forms";

export const dynamic = "force-dynamic";

function TeamName({
  team,
  side,
  view,
}: {
  team: MatchRoomView["team_a"];
  side: MatchSide;
  view: MatchRoomView;
}) {
  const isHost = view.match.host_side === side;
  const isMine = view.captain_side === side || view.viewer === side;
  return (
    <div className={`flex-1 text-center ${side === "a" ? "sm:text-right" : "sm:text-left"}`}>
      <p className={`text-lg font-semibold ${isMine ? "text-brand" : ""}`}>
        {team?.name ?? "Por definir"}
      </p>
      <p className="mt-0.5 text-xs text-ink-faint">
        {team?.tag ? `[${team.tag}]` : " "}
        {isHost && view.has_room ? " · crea la sala" : ""}
      </p>
    </div>
  );
}

export default async function PartidoPage({
  params,
}: PageProps<"/torneos/[slug]/partido/[matchId]">) {
  const { slug, matchId } = await params;
  const code = (await cookies()).get(matchCodeCookie(matchId))?.value ?? null;

  const supabase = await createClient();
  const { data: view } = await supabase.rpc("get_match_room", {
    p_match_id: matchId,
    p_code: code,
  });

  if (!view || view.tournament.slug !== slug) notFound();

  const { match, tournament, room } = view;
  const target = { matchId, slug };
  const teamOf = (side: MatchSide) => (side === "a" ? view.team_a : view.team_b);
  const hostTeam = match.host_side ? teamOf(match.host_side) : null;
  const running = tournament.status === "running";
  const pendingClaim = room?.claim_side && !room.resolved_at ? room : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <RoomLive matchId={matchId} />

      <div>
        <Link
          href={`/torneos/${slug}`}
          className="text-sm text-ink-dim transition hover:text-ink"
        >
          ← {tournament.name}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {roundLabel(match.round, tournament.rounds)}
          </h1>
          <MatchBadge status={match.status} />
        </div>
      </div>

      <section className="card flex flex-col items-center gap-3 p-6 sm:flex-row">
        <TeamName team={view.team_a} side="a" view={view} />
        <span className="font-mono text-sm text-ink-faint">
          {match.status === "done" ? `${match.score_a} – ${match.score_b}` : "vs"}
        </span>
        <TeamName team={view.team_b} side="b" view={view} />
      </section>

      {!view.has_room ? (
        <div className="card p-6 text-sm text-ink-dim">
          {match.status === "done"
            ? "Enfrentamiento terminado."
            : match.status === "bye"
              ? "Este partido se resolvió como pase directo."
              : "Este enfrentamiento todavía no está listo: faltan equipos."}
        </div>
      ) : !view.viewer ? (
        <section className="card space-y-4 p-6">
          <div>
            <h2 className="font-semibold">Ingresa a la sala del enfrentamiento</h2>
            <p className="mt-1 text-sm text-ink-dim">
              Cada equipo tiene su propio código. Pídeselo a tu capitán.
            </p>
          </div>
          {view.my_code ? (
            <div className="space-y-3 rounded-lg border border-brand/40 bg-brand/5 p-4">
              <p className="text-sm">
                Eres el capitán. Tu código es{" "}
                <span className="font-mono font-semibold tracking-widest">{view.my_code}</span>
              </p>
              <CodeForm {...target} presetCode={view.my_code} />
            </div>
          ) : (
            <CodeForm {...target} />
          )}
        </section>
      ) : (
        <>
          <section className="card space-y-4 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Sala</h2>
              {hostTeam ? (
                <p className="text-sm text-ink-dim">
                  La crea{" "}
                  <span className="font-semibold text-ink">
                    {view.captain_side === match.host_side ? "tu equipo" : hostTeam.name}
                  </span>
                </p>
              ) : null}
            </div>

            {room?.room_id ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 px-4 py-3">
                <span className="text-xs uppercase tracking-wider text-ink-faint">ID de sala</span>
                <span className="font-mono text-2xl font-semibold tracking-wider">
                  {room.room_id}
                </span>
                <span className="ml-auto">
                  <CopyButton value={room.room_id} />
                </span>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-line px-4 py-3 text-sm text-ink-dim">
                {view.captain_side === match.host_side
                  ? "Crea una sala personalizada en MLBB y publica aquí su ID para que el rival se una."
                  : `Esperando que ${hostTeam?.name ?? "el otro equipo"} cree la sala y publique su ID.`}
              </p>
            )}

            {view.captain_side &&
            view.captain_side === match.host_side &&
            running &&
            (match.status === "ready" || match.status === "live") &&
            !pendingClaim ? (
              <RoomIdForm {...target} current={room?.room_id ?? null} />
            ) : null}

            {!running && match.status !== "done" ? (
              <p className="text-xs text-ink-faint">
                La sala se publica cuando el admin inicie el torneo.
              </p>
            ) : null}
          </section>

          <section className="card space-y-4 p-6">
            <h2 className="font-semibold">Resultado</h2>

            {match.status === "done" ? (
              <p className="text-sm">
                Ganó{" "}
                <span className="font-semibold">
                  {match.winner_id === view.team_a?.id ? view.team_a?.name : view.team_b?.name}
                </span>{" "}
                ({match.score_a}–{match.score_b}). Resultado verificado.
              </p>
            ) : pendingClaim ? (
              <>
                <p className="text-sm">
                  <span className="font-semibold">
                    {teamOf(pendingClaim.claim_side!)?.name}
                  </span>{" "}
                  reportó victoria {pendingClaim.claim_score_a}–{pendingClaim.claim_score_b}.
                  Esperando la verificación del admin.
                </p>
                {pendingClaim.disputed_at ? (
                  <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
                    Resultado disputado: {pendingClaim.dispute_note}
                  </p>
                ) : view.captain_side && view.captain_side !== pendingClaim.claim_side ? (
                  <DisputeForm {...target} />
                ) : null}
              </>
            ) : view.captain_side && match.status === "live" && running ? (
              <ClaimForm
                {...target}
                myTeam={teamOf(view.captain_side)?.name ?? "Tu equipo"}
                rivalTeam={teamOf(view.captain_side === "a" ? "b" : "a")?.name ?? "Rival"}
              />
            ) : (
              <p className="text-sm text-ink-dim">
                {match.status === "live"
                  ? "En juego. Al terminar, el capitán ganador reporta el resultado."
                  : "Todavía no empieza."}
              </p>
            )}
          </section>

          {view.my_code ? (
            <p className="text-sm text-ink-dim">
              Código de tu equipo:{" "}
              <span className="font-mono font-semibold tracking-widest text-ink">
                {view.my_code}
              </span>{" "}
              — compártelo con tus jugadores para que vean la sala.
            </p>
          ) : null}

          {view.viewer === "admin" && room ? (
            <p className="text-xs text-ink-faint">
              Admin · códigos: {view.team_a?.name} <span className="font-mono">{room.code_a}</span>{" "}
              · {view.team_b?.name} <span className="font-mono">{room.code_b}</span> ·{" "}
              <Link
                href={`/admin/torneos/${tournament.id}/partidos`}
                className="text-brand hover:brightness-125"
              >
                Verificar resultados
              </Link>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
