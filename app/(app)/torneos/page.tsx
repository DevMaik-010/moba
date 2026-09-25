import Link from "next/link";

import { TournamentBadge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import type { Tournament } from "@/lib/db/types";

export const dynamic = "force-dynamic";

function formatDate(value: string | null): string {
  if (!value) return "Fecha por definir";
  return new Date(value).toLocaleString("es", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function TorneosPage() {
  const supabase = await createClient();

  // RLS ya oculta los borradores a quien no es admin; los archivados se
  // quedan fuera de la lista, pero su página sigue abierta.
  const { data } = await supabase
    .from("tournaments")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  const tournaments = (data ?? []) as Tournament[];

  const counts = new Map<string, number>();
  if (tournaments.length > 0) {
    const { data: teams } = await supabase
      .from("teams")
      .select("tournament_id")
      .not("seed", "is", null);
    for (const row of teams ?? []) {
      counts.set(row.tournament_id!, (counts.get(row.tournament_id!) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Torneos</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Arma tu equipo, valida los IDs y mira cómo se llena el cuadro en vivo.
        </p>
      </div>

      {tournaments.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-ink-dim">Todavía no hay torneos publicados.</p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {tournaments.map((t) => (
            <li key={t.id}>
              <Link
                href={`/torneos/${t.slug}`}
                className="card block p-5 transition hover:border-brand/60"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-semibold">{t.name}</h2>
                  <TournamentBadge status={t.status} />
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-ink-faint">Modo</dt>
                    <dd className="font-mono font-semibold text-brand">{t.mode}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-faint">Cupos</dt>
                    <dd className="font-mono">
                      {counts.get(t.id) ?? 0}/{t.bracket_size}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-faint">Inicio</dt>
                    <dd className="text-xs text-ink-dim">{formatDate(t.starts_at)}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
