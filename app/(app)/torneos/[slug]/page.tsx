import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { BracketView } from "@/components/bracket/bracket-view";
import { TournamentBadge } from "@/components/ui/badge";
import { LocalDate } from "@/components/ui/local-date";
import { TeamLogo } from "@/components/ui/team-logo";
import { roundLabel } from "@/lib/bracket/bracket";
import { matchPath } from "@/lib/match-access";
import { createClient, getSession } from "@/lib/supabase/server";
import { TEAM_SIZE_BY_MODE } from "@/lib/db/types";
import type { Match, Team, Tournament } from "@/lib/db/types";
import { CopyButton } from "./partido/[matchId]/match-forms";

export const dynamic = "force-dynamic";

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-0.5 font-display text-xl tabular-nums">{value}</p>
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

  // El enfrentamiento en curso del capitán y quién crea la sala.
  const allMatches = (matches ?? []) as Match[];
  const myMatch =
    myTeam && (tournament.status === "locked" || tournament.status === "running")
      ? allMatches.find(
          (m) =>
            (m.team_a_id === myTeam.id || m.team_b_id === myTeam.id) &&
            (m.status === "ready" || m.status === "live"),
        )
      : undefined;
  const [myRoom, myCode] = await Promise.all([
    myMatch
      ? supabase
          .rpc("get_match_room", { p_match_id: myMatch.id, p_code: null })
          .then(({ data }) => data)
      : null,
    // RLS: solo el capitán (o el admin) lee el código de su equipo.
    myTeam
      ? supabase
          .from("team_access_codes")
          .select("code")
          .eq("team_id", myTeam.id)
          .maybeSingle<{ code: string }>()
          .then(({ data }) => data?.code ?? null)
      : null,
  ]);
  const totalRounds = allMatches.reduce((max, m) => Math.max(max, m.round), 0);

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

      {myTeam ? (
        <section className="card flex flex-wrap items-center gap-4 border-brand/50 bg-brand/5 p-5">
          <TeamLogo name={myTeam.name} tag={myTeam.tag} path={myTeam.logo_path} size={48} />
          <div className="min-w-0 flex-1 space-y-1">
            {myMatch && myRoom ? (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">
                  Tu enfrentamiento · {roundLabel(myMatch.round, totalRounds)}
                </p>
                <p className="font-semibold">
                  {myTeam.name} vs{" "}
                  {(myRoom.captain_side === "a" ? myRoom.team_b : myRoom.team_a)?.name ??
                    "Por definir"}
                </p>
                <p className="text-sm text-ink-dim">
                  {!myRoom.match.host_side
                    ? "Entra a la sala del enfrentamiento para sortear quién la crea."
                    : myRoom.match.host_side === myRoom.captain_side
                      ? "Tu equipo crea la sala en MLBB y publica el ID."
                      : "El rival crea la sala; verás el ID al entrar."}
                </p>
              </>
            ) : (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">
                  Inscrito · cupo #{myTeam.seed}
                </p>
                <p className="font-semibold">{myTeam.name}</p>
              </>
            )}
            {myCode ? (
              <p className="flex flex-wrap items-center gap-2 text-sm text-ink-dim">
                Código de inscripción:
                <span className="font-mono text-base font-semibold tracking-[0.25em] text-ink">
                  {myCode}
                </span>
                <CopyButton value={myCode} />
              </p>
            ) : null}
            <p className="text-xs text-ink-faint">
              Te lo pediremos para entrar a cada enfrentamiento. Compártelo solo con tu equipo.
            </p>
          </div>
          {myMatch ? (
            <Link
              href={matchPath(tournament.slug, myMatch.id)}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Ir al enfrentamiento
            </Link>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Equipos inscritos" value={`${registered.length} / ${tournament.bracket_size}`} />
        <Stat label="Modo" value={tournament.mode} />
        <Stat
          label="Inicio"
          value={
            tournament.starts_at ? (
              <LocalDate
                iso={tournament.starts_at}
                options={{ day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }}
              />
            ) : (
              "Por definir"
            )
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
          initialMatches={allMatches}
          initialTeams={registered}
          highlightTeamId={myTeam?.id ?? null}
          slug={tournament.slug}
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
                <TeamLogo name={team.name} tag={team.tag} path={team.logo_path} size={28} />
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
