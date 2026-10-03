import Link from "next/link";

import { TournamentBadge } from "@/components/ui/badge";
import { SwordsIcon } from "@/components/ui/icons";
import { LocalDate } from "@/components/ui/local-date";
import { createClient } from "@/lib/supabase/server";
import type { Tournament } from "@/lib/db/types";

export const dynamic = "force-dynamic";

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
        <p className="kicker">
          <span className="h-0.5 w-6 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" aria-hidden />
          Mobile Legends · Bang Bang
        </p>
        <h1 className="mt-2 text-3xl tracking-tight sm:text-4xl">Torneos</h1>
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
          {tournaments.map((t, i) => {
            const filled = counts.get(t.id) ?? 0;
            const pct = Math.min(100, Math.round((filled / t.bracket_size) * 100));
            return (
            <li key={t.id} className="animate-rise" style={{ animationDelay: `${i * 40}ms` }}>
              <Link
                href={`/torneos/${t.slug}`}
                className="card group relative block cursor-pointer overflow-hidden p-5 transition duration-200 hover:-translate-y-0.5 hover:border-brand/70 hover:shadow-[0_14px_36px_-18px_var(--color-brand)]"
              >
                <SwordsIcon
                  size={96}
                  className="pointer-events-none absolute -right-4 -bottom-4 text-brand/10 transition group-hover:text-brand/20"
                />
                <div className="relative flex items-start justify-between gap-3">
                  <h2 className="text-lg leading-tight">{t.name}</h2>
                  <TournamentBadge status={t.status} />
                </div>

                <dl className="relative mt-4 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-ink-faint">Modo</dt>
                    <dd className="font-display text-lg text-brand">{t.mode}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-faint">Cupos</dt>
                    <dd className="font-display text-lg tabular-nums">
                      {filled}
                      <span className="text-sm text-ink-faint">/{t.bracket_size}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-faint">Inicio</dt>
                    <dd className="text-xs text-ink-dim">
                      {t.starts_at ? (
                        <LocalDate
                          iso={t.starts_at}
                          options={{ dateStyle: "medium", timeStyle: "short" }}
                        />
                      ) : (
                        "Fecha por definir"
                      )}
                    </dd>
                  </div>
                </dl>

                <div
                  className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-surface-3"
                  role="img"
                  aria-label={`${filled} de ${t.bracket_size} cupos ocupados`}
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand to-accent shadow-[0_0_10px_var(--color-brand)]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </Link>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
