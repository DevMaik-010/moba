import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { LocalDate } from "@/components/ui/local-date";
import { signedEvidenceUrls } from "@/lib/evidence-server";
import { matchPath } from "@/lib/match-access";
import { REASON_LABEL, REPORT_STATUS_LABEL } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Report, ReportStatus, Team, Tournament } from "@/lib/db/types";
import { ResolveReportForm } from "./resolve-form";

export const dynamic = "force-dynamic";

const FILTERS: { key: string; label: string; statuses: ReportStatus[] }[] = [
  { key: "pendientes", label: "Pendientes", statuses: ["open", "reviewing"] },
  { key: "cerrados", label: "Cerrados", statuses: ["resolved", "dismissed"] },
];

export default async function AdminReportesPage({ searchParams }: PageProps<"/admin/reportes">) {
  const { estado } = await searchParams;
  const filter = FILTERS.find((f) => f.key === estado) ?? FILTERS[0];

  const supabase = await createClient();
  const { data } = await supabase
    .from("reports")
    .select("*")
    .in("status", filter.statuses)
    .order("created_at", { ascending: false })
    .limit(100);
  const reports = (data ?? []) as Report[];

  const ids = <K extends keyof Report>(key: K) =>
    [...new Set(reports.flatMap((r) => (r[key] ? [r[key] as string] : [])))];
  const tournamentIds = ids("tournament_id");
  const teamIds = ids("reported_team_id");
  const reporterIds = ids("reporter_id");

  const [{ data: tournaments }, { data: teams }, { data: profiles }, evidence] = await Promise.all([
    tournamentIds.length
      ? supabase.from("tournaments").select("*").in("id", tournamentIds)
      : Promise.resolve({ data: [] as Tournament[] }),
    teamIds.length
      ? supabase.from("teams").select("*").in("id", teamIds)
      : Promise.resolve({ data: [] as Team[] }),
    reporterIds.length
      ? supabase.from("profiles").select("*").in("id", reporterIds)
      : Promise.resolve({ data: [] as Profile[] }),
    signedEvidenceUrls(reports.map((r) => r.evidence_path)),
  ]);

  const tournamentById = new Map(((tournaments ?? []) as Tournament[]).map((t) => [t.id, t]));
  const teamName = new Map(((teams ?? []) as Team[]).map((t) => [t.id, t.name]));
  const reporterName = new Map(((profiles ?? []) as Profile[]).map((p) => [p.id, p.display_name]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reportes de conducta</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Incumplimientos de reglas que enviaron los jugadores. Las sanciones (quitar un equipo,
          dar una partida) se aplican desde el torneo.
        </p>
      </div>

      <nav className="flex gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/reportes?estado=${f.key}`}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              f.key === filter.key
                ? "bg-surface-2 font-semibold text-ink"
                : "text-ink-dim hover:text-ink"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {reports.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-dim">No hay reportes aquí.</div>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => {
            const [label, tone] = REPORT_STATUS_LABEL[r.status];
            const tournament = tournamentById.get(r.tournament_id);
            const url = r.evidence_path ? evidence.get(r.evidence_path) : undefined;
            return (
              <li key={r.id} className="card space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone="bad">{REASON_LABEL[r.reason]}</Badge>
                  <span className="font-semibold">
                    {[r.reported_team_id ? teamName.get(r.reported_team_id) : null, r.reported_player]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                  <span className="ml-auto">
                    <Badge tone={tone}>{label}</Badge>
                  </span>
                </div>

                <p className="text-xs text-ink-faint">
                  {tournament ? (
                    <Link
                      href={`/admin/torneos/${tournament.id}`}
                      className="text-brand hover:brightness-125"
                    >
                      {tournament.name}
                    </Link>
                  ) : (
                    "Torneo"
                  )}
                  {r.match_id && tournament ? (
                    <>
                      {" · "}
                      <Link
                        href={matchPath(tournament.slug, r.match_id)}
                        className="text-brand hover:brightness-125"
                      >
                        ver enfrentamiento
                      </Link>
                    </>
                  ) : null}
                  {" · reportó "}
                  {reporterName.get(r.reporter_id) ?? "—"} ·{" "}
                  <LocalDate iso={r.created_at} options={{ dateStyle: "medium", timeStyle: "short" }} />
                </p>

                <p className="whitespace-pre-line text-sm">{r.description}</p>

                {url ? (
                  <a href={url} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada temporal */}
                    <img
                      src={url}
                      alt="Evidencia del reporte"
                      className="max-h-64 rounded-md border border-line object-contain"
                    />
                  </a>
                ) : null}

                <div className="border-t border-line pt-3">
                  <ResolveReportForm reportId={r.id} status={r.status} note={r.admin_note} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
