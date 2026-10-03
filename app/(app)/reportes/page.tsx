import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { LocalDate } from "@/components/ui/local-date";
import { REASON_LABEL, REPORT_STATUS_LABEL } from "@/lib/reports";
import { createClient, getSession } from "@/lib/supabase/server";
import type { Report, Team, Tournament } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export default async function ReportesPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/reportes");

  const supabase = await createClient();
  const { data } = await supabase
    .from("reports")
    .select("*")
    .eq("reporter_id", session.userId)
    .order("created_at", { ascending: false });
  const reports = (data ?? []) as Report[];

  const tournamentIds = [...new Set(reports.map((r) => r.tournament_id))];
  const teamIds = [...new Set(reports.flatMap((r) => (r.reported_team_id ? [r.reported_team_id] : [])))];
  const [{ data: tournaments }, { data: teams }] = await Promise.all([
    tournamentIds.length
      ? supabase.from("tournaments").select("*").in("id", tournamentIds)
      : Promise.resolve({ data: [] as Tournament[] }),
    teamIds.length
      ? supabase.from("teams").select("*").in("id", teamIds)
      : Promise.resolve({ data: [] as Team[] }),
  ]);
  const tournamentName = new Map(((tournaments ?? []) as Tournament[]).map((t) => [t.id, t.name]));
  const teamName = new Map(((teams ?? []) as Team[]).map((t) => [t.id, t.name]));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reportes</h1>
          <p className="mt-1 text-sm text-ink-dim">
            Los reportes que enviaste desde la sala de tus enfrentamientos. Un admin los revisa.
          </p>
        </div>
        <Link
          href="/reportes/nuevo"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
        >
          Cómo reportar
        </Link>
      </div>

      {reports.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-dim">
          Todavía no has enviado ningún reporte.
        </div>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => {
            const [label, tone] = REPORT_STATUS_LABEL[r.status];
            return (
              <li key={r.id} className="card space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{REASON_LABEL[r.reason]}</span>
                  <span className="text-ink-faint">·</span>
                  <span className="text-ink-dim">
                    {[r.reported_team_id ? teamName.get(r.reported_team_id) : null, r.reported_player]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                  <span className="ml-auto">
                    <Badge tone={tone}>{label}</Badge>
                  </span>
                </div>
                <p className="text-xs text-ink-faint">
                  {tournamentName.get(r.tournament_id) ?? "Torneo"} ·{" "}
                  <LocalDate iso={r.created_at} options={{ dateStyle: "medium", timeStyle: "short" }} />
                </p>
                <p className="whitespace-pre-line text-sm text-ink-dim">{r.description}</p>
                {r.admin_note ? (
                  <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
                    <span className="text-ink-faint">Respuesta del admin: </span>
                    {r.admin_note}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
