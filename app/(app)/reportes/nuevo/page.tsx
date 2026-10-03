import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { roundLabel } from "@/lib/bracket/bracket";
import { matchPath, teamCodeCookie } from "@/lib/match-access";
import { createClient, getSession } from "@/lib/supabase/server";
import { ReportForm } from "./report-form";

export const dynamic = "force-dynamic";

/** Sin un enfrentamiento al que se tenga acceso no hay formulario: se explica dónde reportar. */
function ReportFromRoom({ href }: { href?: string }) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/reportes" className="text-sm text-ink-dim transition hover:text-ink">
          ← Mis reportes
        </Link>
        <h1 className="mt-2 text-2xl tracking-tight">Nuevo reporte</h1>
      </div>
      <div className="card space-y-3 p-6 text-sm text-ink-dim">
        <p>
          Los reportes se hacen desde la <span className="font-semibold text-ink">sala del
          enfrentamiento</span>, y solo los equipos que lo juegan pueden reportarlo.
        </p>
        <p>
          Entra a tu partido con el código de tu equipo (está en Mis equipos → Mis inscripciones)
          y usa <span className="font-semibold text-ink">Reportar una incidencia</span>.
        </p>
        {href ? (
          <Link
            href={href}
            className="inline-flex rounded-lg bg-brand px-4 py-2 font-semibold text-white transition hover:brightness-110"
          >
            Ir a la sala del enfrentamiento
          </Link>
        ) : (
          <Link
            href="/mis-equipos"
            className="inline-flex rounded-lg bg-brand px-4 py-2 font-semibold text-white transition hover:brightness-110"
          >
            Ir a Mis equipos
          </Link>
        )}
      </div>
    </div>
  );
}

export default async function NuevoReportePage({ searchParams }: PageProps<"/reportes/nuevo">) {
  const { torneo, partido } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login?next=/reportes/nuevo");

  if (typeof torneo !== "string" || !torneo || typeof partido !== "string" || !partido) {
    return <ReportFromRoom />;
  }

  // El acceso lo decide la base con el código guardado al entrar a la sala.
  const code = (await cookies()).get(teamCodeCookie(torneo))?.value ?? null;
  const supabase = await createClient();
  const { data: view } = await supabase.rpc("get_match_room", { p_match_id: partido, p_code: code });
  if (!view || view.tournament.slug !== torneo) notFound();
  if (!view.viewer || !view.team_a || !view.team_b) {
    return <ReportFromRoom href={matchPath(torneo, partido)} />;
  }

  const teams = [view.team_a, view.team_b].map((t) => ({
    id: t.id,
    label: t.tag ? `${t.name} [${t.tag}]` : t.name,
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href={matchPath(torneo, partido)}
          className="text-sm text-ink-dim transition hover:text-ink"
        >
          ← Volver a la sala
        </Link>
        <h1 className="mt-2 text-2xl tracking-tight">Reportar una incidencia</h1>
        <p className="mt-1 text-sm text-ink-dim">
          {view.tournament.name}. El reporte solo lo ven tú y los administradores. Los reportes
          falsos también se sancionan.
        </p>
      </div>

      <ReportForm
        userId={session.userId}
        tournamentId={view.tournament.id}
        slug={torneo}
        teams={teams}
        match={{
          id: partido,
          label: `${roundLabel(view.match.round, view.tournament.rounds)}: ${view.team_a.name} vs ${view.team_b.name}`,
        }}
      />
    </div>
  );
}
