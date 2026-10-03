import Link from "next/link";

import { CrownIcon, TrophyIcon } from "@/components/ui/icons";
import { LocalDate } from "@/components/ui/local-date";
import { TeamLogo } from "@/components/ui/team-logo";
import { createClient } from "@/lib/supabase/server";
import type { TeamRankingRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Ranking de equipos" };

export default async function RankingPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("team_ranking");
  const rows = (data ?? []) as TeamRankingRow[];

  return (
    <div className="space-y-6">
      <div>
        <p className="kicker">
          <span className="h-0.5 w-6 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" aria-hidden />
          Salón de campeones
        </p>
        <h1 className="mt-2 text-3xl tracking-tight sm:text-4xl">Ranking de equipos</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Equipos que ganaron un torneo. Se ordenan por títulos, luego por finales jugadas y
          victorias.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="card p-10 text-center">
          <TrophyIcon size={40} className="mx-auto text-ink-faint" />
          <p className="mt-3 text-ink-dim">
            Todavía no hay campeones. El ranking se arma al terminar el primer torneo.
          </p>
        </div>
      ) : (
        <ol className="space-y-3">
          {rows.map((row, i) => {
            const first = i === 0;
            return (
              <li
                key={row.team_key}
                className={`card animate-rise flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:flex-nowrap ${
                  first ? "border-accent/60 shadow-[0_14px_36px_-20px_var(--color-accent)]" : ""
                }`}
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <span
                  className={`w-8 shrink-0 text-center font-display text-2xl tabular-nums ${
                    first ? "text-accent" : "text-ink-faint"
                  }`}
                >
                  {first ? (
                    <>
                      <CrownIcon size={26} className="mx-auto" />
                      <span className="sr-only">1</span>
                    </>
                  ) : (
                    i + 1
                  )}
                </span>

                <TeamLogo name={row.name} tag={row.tag} path={row.logo_path} size={44} />

                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-lg leading-tight">
                    {row.name}
                    {row.tag ? (
                      <span className="ml-2 font-mono text-xs text-ink-faint">[{row.tag}]</span>
                    ) : null}
                  </p>
                  {row.last_title_slug ? (
                    <p className="mt-0.5 truncate text-xs text-ink-dim">
                      Último título:{" "}
                      <Link
                        href={`/torneos/${row.last_title_slug}`}
                        className="text-ink hover:text-brand"
                      >
                        {row.last_title_name}
                      </Link>
                      {row.last_title_at ? (
                        <>
                          {" · "}
                          <LocalDate iso={row.last_title_at} options={{ dateStyle: "medium" }} />
                        </>
                      ) : null}
                    </p>
                  ) : null}
                </div>

                <dl className="grid w-full grid-cols-4 gap-2 text-center text-sm sm:w-auto sm:gap-5">
                  {[
                    ["Títulos", row.titles, "text-accent"],
                    ["Finales", row.finals, ""],
                    ["Victorias", row.wins, "text-win"],
                    ["Torneos", row.tournaments, ""],
                  ].map(([label, value, tone]) => (
                    <div key={label as string}>
                      <dt className="text-[11px] uppercase tracking-wider text-ink-faint">
                        {label}
                      </dt>
                      <dd className={`font-display text-lg tabular-nums ${tone}`}>{value}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
