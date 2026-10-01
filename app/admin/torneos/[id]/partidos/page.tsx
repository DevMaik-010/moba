import Link from "next/link";
import { notFound } from "next/navigation";

import { confirmMatchClaim, rejectMatchClaim } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { Badge, MatchBadge } from "@/components/ui/badge";
import { roundLabel } from "@/lib/bracket/bracket";
import { createClient } from "@/lib/supabase/server";
import { matchPath } from "@/lib/match-access";
import type { Match, MatchRoom, Team, TeamAccessCode, Tournament } from "@/lib/db/types";
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

  const [{ data: matches }, { data: teams }, { data: rooms }, { data: codes }] =
    await Promise.all([
      supabase.from("matches").select("*").eq("tournament_id", id).order("round").order("slot"),
      supabase.from("teams").select("*").eq("tournament_id", id),
      supabase.from("match_rooms").select("*").eq("tournament_id", id),
      supabase.from("team_access_codes").select("*").eq("tournament_id", id),
    ]);

  const codeByTeam = new Map(
    ((codes ?? []) as TeamAccessCode[]).map((c) => [c.team_id, c.code]),
  );
  const code = (teamId: string | null) => (teamId ? codeByTeam.get(teamId) : null) ?? "—";

  const roomByMatch = new Map(((rooms ?? []) as MatchRoom[]).map((r) => [r.match_id, r]));
  const openClaims = ((rooms ?? []) as MatchRoom[]).filter(
    (r) => r.claim_side && !r.resolved_at,
  ).length;

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
                const claim = room?.claim_side && !room.resolved_at ? room : null;
                const claimTeam = claim
                  ? name(claim.claim_side === "a" ? match.team_a_id : match.team_b_id)
                  : "";
                const playable =
                  match.team_a_id !== null &&
                  match.team_b_id !== null &&
                  match.status !== "done" &&
                  tournament.status === "running";

                return (
                  <li key={match.id} className="card space-y-3 p-4">
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="font-mono text-xs text-ink-faint">
                        R{match.round}·{match.slot}
                      </span>
                      <span
                        className={
                          match.winner_id === match.team_a_id && match.status === "done"
                            ? "font-semibold"
                            : ""
                        }
                      >
                        {name(match.team_a_id)}
                      </span>
                      <span className="font-mono text-xs text-ink-faint">vs</span>
                      <span
                        className={
                          match.winner_id === match.team_b_id && match.status === "done"
                            ? "font-semibold"
                            : ""
                        }
                      >
                        {name(match.team_b_id)}
                      </span>
                      {match.status === "done" ? (
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

                    {claim ? (
                      <div
                        className={`space-y-3 rounded-lg border p-3 ${
                          claim.disputed_at ? "border-warn/40 bg-warn/5" : "border-brand/40 bg-brand/5"
                        }`}
                      >
                        <p className="text-sm">
                          <span className="font-semibold">{claimTeam}</span> reporta victoria{" "}
                          <span className="font-mono">
                            {claim.claim_score_a}–{claim.claim_score_b}
                          </span>
                          .
                        </p>
                        {claim.disputed_at ? (
                          <p className="text-sm text-warn">
                            El rival lo disputa: “{claim.dispute_note}”
                          </p>
                        ) : null}
                        <div className="flex flex-wrap items-start gap-3">
                          <ActionForm
                            action={confirmMatchClaim}
                            fields={{ matchId: match.id, tournamentId: id }}
                            label="Confirmar y avanzar"
                            variant="primary"
                            confirm={`¿Confirmar la victoria de ${claimTeam}? Pasa a la siguiente fase.`}
                          />
                          <ActionForm
                            action={rejectMatchClaim}
                            fields={{ matchId: match.id, tournamentId: id }}
                            label="Rechazar reporte"
                            variant="danger"
                            confirm="Se borra el reporte y los capitanes pueden volver a reportar. ¿Continuar?"
                          />
                        </div>
                      </div>
                    ) : null}

                    {playable && !claim ? (
                      <ReportForm
                        matchId={match.id}
                        tournamentId={id}
                        teamAName={name(match.team_a_id)}
                        teamBName={name(match.team_b_id)}
                      />
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
