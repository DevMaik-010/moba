import Link from "next/link";
import { notFound } from "next/navigation";

import {
  archiveTournament,
  cancelTournament,
  deleteTournament,
  lockTournament,
  openTournament,
  removeTeam,
  startTournament,
  unarchiveTournament,
} from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { BracketView } from "@/components/bracket/bracket-view";
import { Badge, TournamentBadge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import type { Match, Team, Tournament } from "@/lib/db/types";

export const dynamic = "force-dynamic";

const NEXT_STEP: Record<string, string> = {
  draft: "Abre las inscripciones para dibujar el cuadro y dejar que los equipos entren.",
  open: "Los equipos se están inscribiendo. Se cierra solo al llenarse los cupos, o ciérralo tú antes.",
  locked: "Byes resueltos. Revisa el cuadro e inicia el torneo.",
  running: "Torneo en juego: reporta los resultados partido por partido.",
  finished: "Torneo terminado. Archívalo para sacarlo de la lista pública.",
  cancelled: "Torneo cancelado.",
};

export default async function AdminTorneoPage({ params }: PageProps<"/admin/torneos/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("*")
    .eq("id", id)
    .maybeSingle<Tournament>();

  if (!tournament) notFound();

  const [{ data: teams }, { data: matches }] = await Promise.all([
    supabase
      .from("teams")
      .select("*")
      .eq("tournament_id", id)
      .order("seed", { nullsFirst: false }),
    supabase.from("matches").select("*").eq("tournament_id", id).order("round").order("slot"),
  ]);

  const allTeams = (teams ?? []) as Team[];
  const registered = allTeams.filter((t) => t.seed !== null);
  const drafts = allTeams.filter((t) => t.seed === null);

  const closed = tournament.status === "finished" || tournament.status === "cancelled";
  const deletable = tournament.status === "draft" || closed;
  const teamsRemovable = tournament.status === "draft" || tournament.status === "open";

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{tournament.name}</h1>
          <TournamentBadge status={tournament.status} />
          {tournament.archived_at ? <Badge>Archivado</Badge> : null}
          <Link
            href={`/torneos/${tournament.slug}`}
            className="text-sm text-ink-dim hover:text-brand"
          >
            Ver página pública →
          </Link>
        </div>
        <p className="text-sm text-ink-dim">{NEXT_STEP[tournament.status]}</p>

        <div className="flex flex-wrap items-start gap-3">
          {tournament.status === "draft" ? (
            <ActionForm
              action={openTournament}
              fields={{ tournamentId: tournament.id }}
              label="Abrir inscripciones"
              variant="primary"
            />
          ) : null}

          {tournament.status === "open" ? (
            <ActionForm
              action={lockTournament}
              fields={{ tournamentId: tournament.id }}
              label="Cerrar inscripciones"
              variant="primary"
              confirm={`Se cierran las inscripciones con ${registered.length} equipos y se resuelven los pases directos. ¿Continuar?`}
              disabled={registered.length < 2}
            />
          ) : null}

          {tournament.status === "locked" ? (
            <ActionForm
              action={startTournament}
              fields={{ tournamentId: tournament.id }}
              label="Iniciar torneo"
              variant="primary"
            />
          ) : null}

          {tournament.status === "running" || tournament.status === "finished" ? (
            <Link
              href={`/admin/torneos/${tournament.id}/partidos`}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white"
            >
              Reportar resultados
            </Link>
          ) : null}

          <span className="flex flex-wrap items-start gap-3 sm:ml-auto">
            {!closed ? (
              <Link
                href={`/admin/torneos/${tournament.id}/editar`}
                className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-dim transition hover:border-brand hover:text-ink"
              >
                Editar
              </Link>
            ) : null}

            {!closed && tournament.status !== "draft" ? (
              <ActionForm
                action={cancelTournament}
                fields={{ tournamentId: tournament.id }}
                label="Cancelar torneo"
                variant="danger"
                confirm="El torneo queda cancelado y congelado tal cual. No se puede deshacer. ¿Continuar?"
              />
            ) : null}

            {closed && !tournament.archived_at ? (
              <ActionForm
                action={archiveTournament}
                fields={{ tournamentId: tournament.id }}
                label="Archivar"
                confirm="El torneo sale de la lista pública. Su página y resultados se conservan. ¿Archivar?"
              />
            ) : null}

            {tournament.archived_at ? (
              <ActionForm
                action={unarchiveTournament}
                fields={{ tournamentId: tournament.id }}
                label="Desarchivar"
              />
            ) : null}

            {deletable ? (
              <ActionForm
                action={deleteTournament}
                fields={{ tournamentId: tournament.id }}
                label="Eliminar"
                variant="danger"
                confirm={`Se borran el torneo, sus ${allTeams.length} equipos y todos los partidos. No se puede deshacer. ¿Eliminar "${tournament.name}"?`}
              />
            ) : null}
          </span>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Modo", tournament.mode],
          ["Inscritos", `${registered.length}/${tournament.bracket_size}`],
          ["Borradores", String(drafts.length)],
          ["Partidos", String((matches ?? []).length)],
        ].map(([label, value]) => (
          <div key={label} className="card px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</p>
            <p className="mt-0.5 font-mono text-lg font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Cuadro</h2>
        <BracketView
          tournamentId={tournament.id}
          initialMatches={(matches ?? []) as Match[]}
          initialTeams={registered}
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Equipos</h2>
        {allTeams.length === 0 ? (
          <div className="card p-8 text-center text-sm text-ink-dim">
            Sin equipos todavía.
          </div>
        ) : (
          <ul className="space-y-2">
            {allTeams.map((team) => (
              <li key={team.id} className="card flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="font-mono text-xs text-ink-faint">
                  {team.seed !== null ? `#${team.seed}` : "—"}
                </span>
                <span className="font-medium">{team.name}</span>
                {team.tag ? (
                  <span className="font-mono text-xs text-ink-faint">[{team.tag}]</span>
                ) : null}
                <span className="ml-auto">
                  {team.seed === null ? (
                    <Badge tone="warn">Borrador</Badge>
                  ) : team.status === "eliminated" ? (
                    <Badge tone="bad">Eliminado</Badge>
                  ) : (
                    <Badge tone="good">Inscrito</Badge>
                  )}
                </span>
                {teamsRemovable ? (
                  <ActionForm
                    action={removeTeam}
                    fields={{ teamId: team.id, tournamentId: tournament.id }}
                    label="Quitar"
                    variant="danger"
                    confirm={`¿Quitar a "${team.name}" del torneo? Se borra su roster y su cupo queda libre.`}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
