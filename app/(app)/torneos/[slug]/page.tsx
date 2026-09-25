import Link from "next/link";
import { notFound } from "next/navigation";

import { BracketView } from "@/components/bracket/bracket-view";
import { TournamentBadge } from "@/components/ui/badge";
import { createClient, getSession } from "@/lib/supabase/server";
import { TEAM_SIZE_BY_MODE } from "@/lib/db/types";
import type { Match, Team, Tournament } from "@/lib/db/types";

export const dynamic = "force-dynamic";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-0.5 font-mono text-lg font-semibold">{value}</p>
    </div>
  );
}

export default async function TorneoPage({ params }: PageProps<"/torneos/[slug]">) {
  const { slug } = await params;
  const supabase = await createClient();
  const session = await getSession();

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<Tournament>();

  if (!tournament) notFound();

  const [{ data: matches }, { data: teams }] = await Promise.all([
    supabase
      .from("matches")
      .select("*")
      .eq("tournament_id", tournament.id)
      .order("round")
      .order("slot"),
    supabase
      .from("teams")
      .select("*")
      .eq("tournament_id", tournament.id)
      .order("seed", { nullsFirst: false }),
  ]);

  const allTeams = (teams ?? []) as Team[];
  const registered = allTeams.filter((t) => t.seed !== null);
  const myTeam = session
    ? registered.find((t) => t.captain_id === session.userId)
    : undefined;

  const canRegister = tournament.status === "open" && registered.length < tournament.bracket_size;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{tournament.name}</h1>
            <TournamentBadge status={tournament.status} />
          </div>
          <p className="mt-1 text-sm text-ink-dim">
            Modo {tournament.mode} · equipos de {TEAM_SIZE_BY_MODE[tournament.mode]}{" "}
            {TEAM_SIZE_BY_MODE[tournament.mode] === 1 ? "jugador" : "jugadores"}
          </p>
        </div>

        {canRegister ? (
          myTeam ? (
            <Link
              href={`/torneos/${tournament.slug}/inscribir`}
              className="rounded-lg border border-line px-4 py-2 text-sm font-semibold transition hover:border-brand"
            >
              Ver mi inscripción
            </Link>
          ) : (
            <Link
              href={`/torneos/${tournament.slug}/inscribir`}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Inscribir mi equipo
            </Link>
          )
        ) : null}
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Equipos inscritos" value={`${registered.length} / ${tournament.bracket_size}`} />
        <Stat label="Modo" value={tournament.mode} />
        <Stat
          label="Inicio"
          value={
            tournament.starts_at
              ? new Date(tournament.starts_at).toLocaleDateString("es", {
                  day: "2-digit",
                  month: "short",
                })
              : "Por definir"
          }
        />
      </div>

      {tournament.rules ? (
        <section className="card p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-dim">
            Reglas
          </h2>
          <p className="whitespace-pre-line text-sm text-ink-dim">{tournament.rules}</p>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Cuadro</h2>
        <BracketView
          tournamentId={tournament.id}
          initialMatches={(matches ?? []) as Match[]}
          initialTeams={registered}
          highlightTeamId={myTeam?.id ?? null}
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">
          Equipos inscritos{" "}
          <span className="font-mono text-sm text-ink-faint">({registered.length})</span>
        </h2>

        {registered.length === 0 ? (
          <div className="card p-8 text-center text-sm text-ink-dim">
            Nadie se ha inscrito todavía. El primer equipo ocupa el cupo 1.
          </div>
        ) : (
          <ol className="grid gap-2 sm:grid-cols-2">
            {registered.map((team) => (
              <li
                key={team.id}
                className={`card flex items-center gap-3 px-4 py-3 ${
                  team.id === myTeam?.id ? "border-brand/60" : ""
                }`}
              >
                <span className="font-mono text-xs text-ink-faint">#{team.seed}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {team.name}
                </span>
                {team.status === "eliminated" ? (
                  <span className="text-[11px] uppercase text-ink-faint">Eliminado</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
