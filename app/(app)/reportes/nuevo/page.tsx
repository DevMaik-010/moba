import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { TournamentBadge } from "@/components/ui/badge";
import { roundLabel } from "@/lib/bracket/bracket";
import { createClient, getSession } from "@/lib/supabase/server";
import type { Match, Team, Tournament } from "@/lib/db/types";
import { ReportForm } from "./report-form";

export const dynamic = "force-dynamic";

export default async function NuevoReportePage({ searchParams }: PageProps<"/reportes/nuevo">) {
  const { torneo, partido } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login?next=/reportes/nuevo");

  const supabase = await createClient();

  // Sin torneo elegido: primero se elige.
  if (typeof torneo !== "string" || !torneo) {
    const { data } = await supabase
      .from("tournaments")
      .select("*")
      .in("status", ["open", "locked", "running", "finished"])
      .is("archived_at", null)
      .order("created_at", { ascending: false });
    const tournaments = (data ?? []) as Tournament[];

    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <Link href="/reportes" className="text-sm text-ink-dim transition hover:text-ink">
            ← Mis reportes
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">Nuevo reporte</h1>
          <p className="mt-1 text-sm text-ink-dim">¿En qué torneo pasó?</p>
        </div>
        {tournaments.length === 0 ? (
          <div className="card p-8 text-center text-sm text-ink-dim">
            No hay torneos activos para reportar.
          </div>
        ) : (
          <ul className="space-y-2">
            {tournaments.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/reportes/nuevo?torneo=${encodeURIComponent(t.slug)}`}
                  className="card flex flex-wrap items-center gap-3 px-4 py-3 transition hover:border-brand/60"
                >
                  <span className="font-medium">{t.name}</span>
                  <span className="font-mono text-xs text-brand">{t.mode}</span>
                  <span className="ml-auto">
                    <TournamentBadge status={t.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("*")
    .eq("slug", torneo)
    .maybeSingle<Tournament>();
  if (!tournament || tournament.status === "draft") notFound();

  const [{ data: teamRows }, { data: matchRows }] = await Promise.all([
    supabase
      .from("teams")
      .select("*")
      .eq("tournament_id", tournament.id)
      .not("seed", "is", null)
      .order("name"),
    supabase
      .from("matches")
      .select("*")
      .eq("tournament_id", tournament.id)
      .not("team_a_id", "is", null)
      .not("team_b_id", "is", null)
      .order("round")
      .order("slot"),
  ]);

  const teams = (teamRows ?? []) as Team[];
  const matches = (matchRows ?? []) as Match[];
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  // La última ronda del cuadro, aunque todavía no tenga equipos.
  const { data: last } = await supabase
    .from("matches")
    .select("round")
    .eq("tournament_id", tournament.id)
    .order("round", { ascending: false })
    .limit(1)
    .maybeSingle();

  const matchOptions = matches.map((m) => ({
    id: m.id,
    label: `${roundLabel(m.round, last?.round ?? m.round)}: ${teamName.get(m.team_a_id!) ?? "—"} vs ${teamName.get(m.team_b_id!) ?? "—"}`,
  }));
  const defaultMatchId =
    typeof partido === "string" && matches.some((m) => m.id === partido) ? partido : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/reportes/nuevo" className="text-sm text-ink-dim transition hover:text-ink">
          ← Elegir otro torneo
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Reportar un incumplimiento</h1>
        <p className="mt-1 text-sm text-ink-dim">
          {tournament.name}. El reporte solo lo ven tú y los administradores. Los reportes falsos
          también se sancionan.
        </p>
      </div>

      <ReportForm
        userId={session.userId}
        tournamentId={tournament.id}
        teams={teams.map((t) => ({ id: t.id, label: t.tag ? `${t.name} [${t.tag}]` : t.name }))}
        matches={matchOptions}
        defaultMatchId={defaultMatchId}
      />
    </div>
  );
}
