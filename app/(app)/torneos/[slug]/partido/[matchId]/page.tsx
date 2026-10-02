import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { SeriesPips } from "@/components/bracket/series-pips";
import { MatchBadge } from "@/components/ui/badge";
import { roundLabel } from "@/lib/bracket/bracket";
import { TeamLogo } from "@/components/ui/team-logo";
import { signedEvidenceUrls } from "@/lib/evidence-server";
import { teamCodeCookie } from "@/lib/match-access";
import { createClient, getSession } from "@/lib/supabase/server";
import type { MatchGameView, MatchSide, MatchRoomView } from "@/lib/db/types";
import {
  ClaimGameForm,
  CodeForm,
  ConfirmForm,
  CopyButton,
  DisputeForm,
  PrepCountdown,
  ReadyForm,
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
    <div
      className={`flex flex-1 flex-col items-center gap-2 text-center ${
        side === "a" ? "sm:items-end sm:text-right" : "sm:items-start sm:text-left"
      }`}
    >
      <TeamLogo name={team?.name} tag={team?.tag} path={team?.logo_path} size={64} className="rounded-xl" />
      <p className={`text-lg font-semibold ${isMine ? "text-brand" : ""}`}>
        {team?.name ?? "Por definir"}
      </p>
      <p className="mt-0.5 text-xs text-ink-faint">
        {team?.tag ? `[${team.tag}]` : " "}
        {isHost && view.has_room ? " · crea la sala" : ""}
      </p>
    </div>
  );
}

/** Marcador de la serie con un punto por victoria necesaria y la línea de partidas. */
function Scoreboard({ view }: { view: MatchRoomView }) {
  const { match, games } = view;
  const started = match.status === "live" || match.status === "done";
  const leader =
    match.score_a > match.score_b ? "a" : match.score_b > match.score_a ? "b" : null;
  const teamName = (side: MatchSide) =>
    (side === "a" ? view.team_a?.name : view.team_b?.name) ?? "—";

  return (
    <section className="card space-y-5 p-6">
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <TeamName team={view.team_a} side="a" view={view} />
        <div className="flex shrink-0 flex-col items-center gap-2">
          <p className="font-mono text-4xl font-bold tabular-nums">
            <span className={leader === "a" ? "text-win" : ""}>{match.score_a}</span>
            <span className="mx-2 text-ink-faint">–</span>
            <span className={leader === "b" ? "text-win" : ""}>{match.score_b}</span>
          </p>
          <div className="flex items-center gap-3">
            <SeriesPips wins={match.score_a} needed={match.wins_needed} leading={leader === "a"} size="md" label={`${teamName("a")}: ${match.score_a} de ${match.wins_needed}`} />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Bo{match.best_of}
            </span>
            <SeriesPips wins={match.score_b} needed={match.wins_needed} leading={leader === "b"} size="md" label={`${teamName("b")}: ${match.score_b} de ${match.wins_needed}`} />
          </div>
        </div>
        <TeamName team={view.team_b} side="b" view={view} />
      </div>

      <p className="text-center text-xs text-ink-faint">
        Al mejor de {match.best_of}: gana la serie quien llegue a {match.wins_needed}{" "}
        {match.wins_needed === 1 ? "victoria" : "victorias"}.
      </p>

      {started ? (
        <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${match.best_of}, minmax(0, 1fr))` }}>
          {Array.from({ length: match.best_of }, (_, i) => {
            const game = games.find((g) => g.game_no === i + 1);
            const won = game?.winner_side;
            const current = game && !game.resolved_at && match.status === "live";
            return (
              <li
                key={i}
                className={`rounded-lg border px-2 py-2 text-center text-xs ${
                  won
                    ? "border-win/40 bg-win/10"
                    : current
                      ? "border-warn/50 bg-warn/10"
                      : "border-line text-ink-faint"
                }`}
              >
                <p className="font-semibold uppercase tracking-wider">P{i + 1}</p>
                <p className="mt-0.5 truncate">
                  {won ? teamName(won) : current ? "En curso" : "—"}
                </p>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}

/** La partida en curso: preparación, resultado reportado o formulario de victoria. */
function CurrentGame({
  view,
  game,
  target,
  userId,
  screenshotUrl,
}: {
  view: MatchRoomView;
  game: MatchGameView;
  target: { matchId: string; slug: string };
  userId: string | null;
  screenshotUrl: string | null;
}) {
  const teamOf = (side: MatchSide) => (side === "a" ? view.team_a : view.team_b);
  const cap = view.captain_side;
  const inPrep = Date.parse(view.server_now) < Date.parse(game.starts_at);
  const myReady = cap ? (cap === "a" ? game.ready_a : game.ready_b) : false;

  return (
    <section className="card space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Partida {game.game_no}</h2>
        <span className="text-xs text-ink-faint">
          {inPrep ? "Preparación" : game.claim_side ? "Resultado reportado" : "En juego"}
        </span>
      </div>

      {inPrep ? (
        <>
          <p className="text-sm text-ink-dim">
            Tienen hasta 5 minutos para entrar a la sala y preparar el draft. Si los dos capitanes
            marcan que están listos, la partida empieza antes.
          </p>
          <PrepCountdown startsAt={game.starts_at} serverNow={view.server_now} />
          <ul className="flex flex-wrap gap-2 text-sm">
            {(["a", "b"] as const).map((side) => {
              const ready = side === "a" ? game.ready_a : game.ready_b;
              return (
                <li
                  key={side}
                  className={`rounded-full border px-3 py-1 ${
                    ready ? "border-win/40 bg-win/10 text-win" : "border-line text-ink-dim"
                  }`}
                >
                  {teamOf(side)?.name}: {ready ? "listo" : "preparando"}
                </li>
              );
            })}
          </ul>
          {cap && !myReady ? <ReadyForm {...target} /> : null}
        </>
      ) : game.claim_side ? (
        <>
          <p className="text-sm">
            <span className="font-semibold">{teamOf(game.claim_side)?.name}</span> reporta que ganó
            la partida {game.game_no}.{" "}
            {game.disputed_at
              ? "El rival lo disputa: lo decide el admin."
              : "Falta que el capitán rival lo confirme o que el admin lo verifique."}
          </p>
          {screenshotUrl ? (
            <a href={screenshotUrl} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada temporal */}
              <img
                src={screenshotUrl}
                alt={`Captura de la partida ${game.game_no}`}
                className="max-h-80 w-full rounded-lg border border-line object-contain"
              />
            </a>
          ) : null}
          {game.disputed_at ? (
            <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
              Disputa: {game.dispute_note}
            </p>
          ) : null}
          {cap && cap !== game.claim_side ? (
            <div className="space-y-4 border-t border-line pt-4">
              <ConfirmForm {...target} claimTeam={teamOf(game.claim_side)?.name ?? "el rival"} />
              {!game.disputed_at ? <DisputeForm {...target} /> : null}
            </div>
          ) : null}
        </>
      ) : cap && userId ? (
        <ClaimGameForm {...target} userId={userId} gameNo={game.game_no} />
      ) : (
        <p className="text-sm text-ink-dim">
          En juego. Al terminar, el capitán ganador reporta la partida con una captura.
        </p>
      )}
    </section>
  );
}

export default async function PartidoPage({
  params,
}: PageProps<"/torneos/[slug]/partido/[matchId]">) {
  const { slug, matchId } = await params;
  const code = (await cookies()).get(teamCodeCookie(slug))?.value ?? null;

  const supabase = await createClient();
  const [{ data: view }, session] = await Promise.all([
    supabase.rpc("get_match_room", { p_match_id: matchId, p_code: code }),
    getSession(),
  ]);

  if (!view || view.tournament.slug !== slug) notFound();

  const { match, tournament, room } = view;
  const target = { matchId, slug };
  const teamOf = (side: MatchSide) => (side === "a" ? view.team_a : view.team_b);
  const hostTeam = match.host_side ? teamOf(match.host_side) : null;
  const running = tournament.status === "running";
  const currentGame =
    match.status === "live" && running
      ? (view.games.findLast((g) => !g.resolved_at) ?? null)
      : null;
  const pendingClaim = !!currentGame?.claim_side;

  // get_match_room solo entrega la ruta a quien tiene acceso a la sala.
  const urls = view.viewer ? await signedEvidenceUrls([currentGame?.screenshot_path]) : new Map();
  const screenshotUrl = currentGame?.screenshot_path
    ? (urls.get(currentGame.screenshot_path) ?? null)
    : null;

  const winner = match.winner_id === view.team_a?.id ? view.team_a : view.team_b;

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

      <Scoreboard view={view} />

      {!view.has_room ? (
        <div className="card p-6 text-sm text-ink-dim">
          {match.status === "done"
            ? `Enfrentamiento terminado. Ganó ${winner?.name ?? "—"} (${match.score_a}–${match.score_b}).`
            : match.status === "bye"
              ? "Este partido se resolvió como pase directo."
              : "Este enfrentamiento todavía no está listo: faltan equipos."}
        </div>
      ) : !view.viewer ? (
        <section className="card space-y-4 p-6">
          <div>
            <h2 className="font-semibold">Ingresa a la sala del enfrentamiento</h2>
            <p className="mt-1 text-sm text-ink-dim">
              Usa el código que recibió tu equipo al inscribirse. Pídeselo a tu capitán.
            </p>
          </div>
          {view.captain_side ? (
            <p className="rounded-lg border border-brand/40 bg-brand/5 px-4 py-3 text-sm">
              Eres el capitán de{" "}
              <span className="font-semibold">{teamOf(view.captain_side)?.name}</span>. Tu
              código está en{" "}
              <Link href="/mis-equipos" className="text-brand hover:brightness-125">
                Mis equipos → Mis inscripciones
              </Link>
              .
            </p>
          ) : null}
          <CodeForm {...target} />
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
                  ? "Crea una sala personalizada en MLBB y publica aquí su ID. Al publicarla empiezan los 5 minutos de preparación de la partida 1."
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

          {match.status === "done" ? (
            <section className="card p-6 text-sm">
              Ganó la serie <span className="font-semibold">{winner?.name}</span> (
              {match.score_a}–{match.score_b}).
            </section>
          ) : currentGame ? (
            <CurrentGame
              view={view}
              game={currentGame}
              target={target}
              userId={session?.userId ?? null}
              screenshotUrl={screenshotUrl}
            />
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

      <p className="text-center text-xs text-ink-faint">
        ¿Alguien incumplió las reglas?{" "}
        <Link
          href={`/reportes/nuevo?torneo=${encodeURIComponent(slug)}&partido=${matchId}`}
          className="text-brand hover:brightness-125"
        >
          Envía un reporte al admin
        </Link>
      </p>
    </div>
  );
}
