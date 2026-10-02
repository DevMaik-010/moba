import Link from "next/link";
import { notFound } from "next/navigation";

import { rejectGameClaim, resolveGame } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { SeriesPips } from "@/components/bracket/series-pips";
import { Badge, MatchBadge } from "@/components/ui/badge";
import { bestOf, roundLabel, winsNeeded } from "@/lib/bracket/bracket";
import { signedEvidenceUrls } from "@/lib/evidence-server";
import { createClient } from "@/lib/supabase/server";
import { matchPath } from "@/lib/match-access";
import type {
  Match,
  MatchGame,
  MatchSide,
  MatchRoom,
  Team,
  TeamAccessCode,
  Tournament,
} from "@/lib/db/types";
import { ReportForm } from "./report-form";

export const dynamic = "force-dynamic";

export default async function PartidosPage({
  params,
}: PageProps<"/admin/torneos/[id]/partidos">) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("*")
    .eq("id", id)
    .maybeSingle<Tournament>();

  if (!tournament) notFound();

  const [{ data: matches }, { data: teams }, { data: rooms }, { data: codes }, { data: games }] =
    await Promise.all([
      supabase.from("matches").select("*").eq("tournament_id", id).order("round").order("slot"),
      supabase.from("teams").select("*").eq("tournament_id", id),
      supabase.from("match_rooms").select("*").eq("tournament_id", id),
      supabase.from("team_access_codes").select("*").eq("tournament_id", id),
      supabase.from("match_games").select("*").eq("tournament_id", id).order("game_no"),
    ]);

  const codeByTeam = new Map(
    ((codes ?? []) as TeamAccessCode[]).map((c) => [c.team_id, c.code]),
  );
  const code = (teamId: string | null) => (teamId ? codeByTeam.get(teamId) : null) ?? "—";

  const roomByMatch = new Map(((rooms ?? []) as MatchRoom[]).map((r) => [r.match_id, r]));

  const allGames = (games ?? []) as MatchGame[];
  const gamesByMatch = new Map<string, MatchGame[]>();
  for (const g of allGames) {
    gamesByMatch.set(g.match_id, [...(gamesByMatch.get(g.match_id) ?? []), g]);
  }
  const claimed = allGames.filter((g) => g.claim_side && !g.resolved_at);
  const openClaims = claimed.length;
  const screenshots = await signedEvidenceUrls(claimed.map((g) => g.screenshot_path));

  const teamsById = new Map(((teams ?? []) as Team[]).map((t) => [t.id, t]));
  const all = (matches ?? []) as Match[];
  const totalRounds = all.reduce((max, m) => Math.max(max, m.round), 0);

  const byRound = new Map<number, Match[]>();
  for (const m of all) {
    byRound.set(m.round, [...(byRound.get(m.round) ?? []), m]);
  }

  const name = (teamId: string | null) =>
    (teamId ? teamsById.get(teamId)?.name : null) ?? "Por definir";

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/admin/torneos/${id}`}
          className="text-sm text-ink-dim transition hover:text-ink"
        >
          ← {tournament.name}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Resultados</h1>
        {tournament.status !== "running" ? (
          <p className="mt-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
            El torneo debe estar en juego para reportar resultados (estado actual:{" "}
            {tournament.status}).
          </p>
        ) : null}
        {openClaims > 0 ? (
          <p className="mt-2 rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-brand">
            {openClaims}{" "}
            {openClaims === 1 ? "resultado reportado espera" : "resultados reportados esperan"} tu
            verificación.
          </p>
        ) : null}
      </div>

      {[...byRound.entries()]
        .sort(([a], [b]) => a - b)
        .map(([round, roundMatches]) => (
          <section key={round}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-dim">
              {roundLabel(round, totalRounds)}
            </h2>

            <ul className="space-y-3">
              {roundMatches.map((match) => {
                const room = roomByMatch.get(match.id);
                const bo = bestOf(match.round, totalRounds);
                const needed = winsNeeded(bo);
                const matchGames = gamesByMatch.get(match.id) ?? [];
                const current =
                  match.status === "live" ? matchGames.findLast((g) => !g.resolved_at) : undefined;
                const claim = current?.claim_side ? current : null;
                const sideName = (side: MatchSide) =>
                  name(side === "a" ? match.team_a_id : match.team_b_id);
                const rival = (side: MatchSide): MatchSide => (side === "a" ? "b" : "a");
                const playable =
                  match.team_a_id !== null &&
                  match.team_b_id !== null &&
                  match.status !== "done" &&
                  tournament.status === "running";
                const fields = (extra: Record<string, string> = {}) => ({
                  gameId: current?.id ?? "",
                  tournamentId: id,
                  ...extra,
                });
                const screenshot = claim?.screenshot_path
                  ? screenshots.get(claim.screenshot_path)
                  : undefined;

                return (
                  <li key={match.id} className="card space-y-3 p-4">
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="font-mono text-xs text-ink-faint">
                        R{match.round}·{match.slot} · Bo{bo}
                      </span>
                      {(["a", "b"] as const).map((side) => {
                        const teamId = side === "a" ? match.team_a_id : match.team_b_id;
                        const score = side === "a" ? match.score_a : match.score_b;
                        const other = side === "a" ? match.score_b : match.score_a;
                        const ahead =
                          match.status === "done" ? match.winner_id === teamId : score > other;
                        return (
                          <span key={side} className="flex items-center gap-2">
                            {side === "b" ? (
                              <span className="font-mono text-xs text-ink-faint">vs</span>
                            ) : null}
                            <span className={ahead ? "font-semibold" : ""}>{name(teamId)}</span>
                            {match.status === "live" || match.status === "done" ? (
                              <SeriesPips wins={score} needed={needed} leading={ahead} />
                            ) : null}
                          </span>
                        );
                      })}
                      {match.status === "live" || match.status === "done" ? (
                        <span className="font-mono text-xs">
                          {match.score_a}–{match.score_b}
                        </span>
                      ) : null}
                      <span className="ml-auto flex items-center gap-2">
                        {claim ? (
                          <Badge tone={claim.disputed_at ? "warn" : "brand"}>
                            {claim.disputed_at ? "Disputado" : "Por verificar"}
                          </Badge>
                        ) : null}
                        <MatchBadge status={match.status} />
                      </span>
                    </div>

                    {room ? (
                      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-dim">
                        <div>
                          <dt className="inline text-ink-faint">Código {name(match.team_a_id)}: </dt>
                          <dd className="inline font-mono">{code(match.team_a_id)}</dd>
                        </div>
                        <div>
                          <dt className="inline text-ink-faint">Código {name(match.team_b_id)}: </dt>
                          <dd className="inline font-mono">{code(match.team_b_id)}</dd>
                        </div>
                        <div>
                          <dt className="inline text-ink-faint">Crea la sala: </dt>
                          <dd className="inline">
                            {name(match.host_side === "a" ? match.team_a_id : match.team_b_id)}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline text-ink-faint">ID de sala: </dt>
                          <dd className="inline font-mono">{room.room_id ?? "sin publicar"}</dd>
                        </div>
                        <Link
                          href={matchPath(tournament.slug, match.id)}
                          className="text-brand hover:brightness-125"
                        >
                          Ver sala →
                        </Link>
                      </dl>
                    ) : null}

                    {matchGames.some((g) => g.winner_side) ? (
                      <ol className="flex flex-wrap gap-2 text-xs">
                        {matchGames
                          .filter((g) => g.winner_side)
                          .map((g) => (
                            <li
                              key={g.id}
                              className="rounded-full border border-win/40 bg-win/10 px-2 py-0.5"
                            >
                              P{g.game_no}: {sideName(g.winner_side!)}{" "}
                              <span className="text-ink-faint">
                                ({g.resolved_via === "rival" ? "confirmó el rival" : "admin"})
                              </span>
                            </li>
                          ))}
                      </ol>
                    ) : null}

                    {claim ? (
                      <div
                        className={`space-y-3 rounded-lg border p-3 ${
                          claim.disputed_at ? "border-warn/40 bg-warn/5" : "border-brand/40 bg-brand/5"
                        }`}
                      >
                        <p className="text-sm">
                          <span className="font-semibold">{sideName(claim.claim_side!)}</span>{" "}
                          reporta que ganó la partida {claim.game_no}.
                        </p>
                        {screenshot ? (
                          <a href={screenshot} target="_blank" rel="noreferrer" className="block">
                            {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada temporal */}
                            <img
                              src={screenshot}
                              alt={`Captura de la partida ${claim.game_no}`}
                              className="max-h-64 rounded-md border border-line object-contain"
                            />
                          </a>
                        ) : (
                          <p className="text-xs text-ink-faint">Sin captura disponible.</p>
                        )}
                        {claim.disputed_at ? (
                          <p className="text-sm text-warn">
                            El rival lo disputa: “{claim.dispute_note}”
                          </p>
                        ) : null}
                        <div className="flex flex-wrap items-start gap-3">
                          <ActionForm
                            action={resolveGame}
                            fields={fields({ winner: claim.claim_side! })}
                            label={`Confirmar: gana ${sideName(claim.claim_side!)}`}
                            variant="primary"
                            confirm={`¿Dar la partida ${claim.game_no} a ${sideName(claim.claim_side!)}?`}
                          />
                          <ActionForm
                            action={resolveGame}
                            fields={fields({ winner: rival(claim.claim_side!) })}
                            label={`Dar a ${sideName(rival(claim.claim_side!))}`}
                            confirm="El reporte era falso: la partida se registra para el rival. ¿Continuar?"
                          />
                          <ActionForm
                            action={rejectGameClaim}
                            fields={fields()}
                            label="Rechazar reporte"
                            variant="danger"
                            confirm="Se borra el reporte y el capitán puede volver a reportar. ¿Continuar?"
                          />
                        </div>
                      </div>
                    ) : current && tournament.status === "running" ? (
                      <div className="flex flex-wrap items-center gap-3 text-sm text-ink-dim">
                        <span>Partida {current.game_no} sin reporte. Adjudicar a:</span>
                        {(["a", "b"] as const).map((side) => (
                          <ActionForm
                            key={side}
                            action={resolveGame}
                            fields={fields({ winner: side })}
                            label={sideName(side)}
                            confirm={`¿Dar la partida ${current.game_no} a ${sideName(side)} sin reporte?`}
                          />
                        ))}
                      </div>
                    ) : null}

                    {playable && !claim ? (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-xs text-ink-faint hover:text-ink">
                          Fijar la serie completa a mano (gana quien llegue a {needed})
                        </summary>
                        <div className="mt-3">
                          <ReportForm
                            matchId={match.id}
                            tournamentId={id}
                            teamAName={name(match.team_a_id)}
                            teamBName={name(match.team_b_id)}
                          />
                        </div>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

      {all.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-dim">
          El cuadro todavía no existe. Abre las inscripciones primero.
        </div>
      ) : null}
    </div>
  );
}
