import Link from "next/link";
import { notFound } from "next/navigation";

import { MatchBadge } from "@/components/ui/badge";
import { roundLabel } from "@/lib/bracket/bracket";
import { createClient } from "@/lib/supabase/server";
import type { Match, Team, Tournament } from "@/lib/db/types";
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

  const [{ data: matches }, { data: teams }] = await Promise.all([
    supabase.from("matches").select("*").eq("tournament_id", id).order("round").order("slot"),
    supabase.from("teams").select("*").eq("tournament_id", id),
  ]);

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
                      <span className="ml-auto">
                        <MatchBadge status={match.status} />
                      </span>
                    </div>

                    {playable ? (
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
