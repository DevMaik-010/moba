import Link from "next/link";
import { redirect } from "next/navigation";

import { ActionForm } from "@/components/admin/action-form";
import { Badge, TournamentBadge, ValidationBadge } from "@/components/ui/badge";
import { createClient, getSession } from "@/lib/supabase/server";
import type { SavedTeam, SavedTeamMember, Team, Tournament } from "@/lib/db/types";
import { deleteSavedTeam } from "./actions";

export const dynamic = "force-dynamic";

export default async function MisEquiposPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/mis-equipos");

  const supabase = await createClient();

  const [{ data: saved }, { data: entries }] = await Promise.all([
    supabase
      .from("saved_teams")
      .select("*")
      .eq("owner_id", session.userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("teams")
      .select("*")
      .eq("captain_id", session.userId)
      .not("seed", "is", null)
      .order("created_at", { ascending: false }),
  ]);

  const myTeams = (saved ?? []) as SavedTeam[];
  const myEntries = (entries ?? []) as Team[];

  const [{ data: members }, { data: tournaments }] = await Promise.all([
    myTeams.length > 0
      ? supabase
          .from("saved_team_members")
          .select("*")
          .in("saved_team_id", myTeams.map((t) => t.id))
          .order("slot")
      : Promise.resolve({ data: [] }),
    myEntries.length > 0
      ? supabase
          .from("tournaments")
          .select("*")
          .in("id", myEntries.map((t) => t.tournament_id))
      : Promise.resolve({ data: [] }),
  ]);

  const tournamentById = new Map(
    ((tournaments ?? []) as Tournament[]).map((t) => [t.id, t]),
  );

  return (
    <div className="space-y-10">
      <section className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Mis equipos</h1>
            <p className="mt-1 text-sm text-ink-dim">
              Arma tu equipo una vez y úsalo en cada torneo de su modo.
            </p>
          </div>
          <Link
            href="/mis-equipos/nuevo"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Nuevo equipo
          </Link>
        </div>

        {myTeams.length === 0 ? (
          <div className="card p-10 text-center">
            <p className="text-ink-dim">Todavía no has armado ningún equipo.</p>
            <Link
              href="/mis-equipos/nuevo"
              className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
            >
              Armar mi primer equipo
            </Link>
          </div>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {myTeams.map((team) => {
              const roster = ((members ?? []) as SavedTeamMember[]).filter(
                (m) => m.saved_team_id === team.id,
              );

              return (
                <li key={team.id} className="card flex flex-col p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{team.name}</h2>
                    {team.tag ? (
                      <span className="font-mono text-xs text-ink-faint">[{team.tag}]</span>
                    ) : null}
                    <span className="ml-auto">
                      <Badge tone="brand">{team.mode}</Badge>
                    </span>
                  </div>

                  <ul className="mt-4 flex-1 space-y-1.5">
                    {roster.map((m) => (
                      <li
                        key={m.id}
                        className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm"
                      >
                        <span className="font-mono text-xs text-ink-faint">
                          {m.slot === 1 ? "C" : m.slot}
                        </span>
                        <span className="font-mono text-xs">
                          {m.game_user_id} · {m.zone_id}
                        </span>
                        {m.nickname ? (
                          <span className="font-medium">{m.nickname}</span>
                        ) : null}
                        <span className="ml-auto">
                          <ValidationBadge status={m.validation_status} />
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-4 flex flex-wrap items-start gap-3">
                    <Link
                      href={`/mis-equipos/${team.id}`}
                      className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-dim transition hover:border-brand hover:text-ink"
                    >
                      Editar
                    </Link>
                    <ActionForm
                      action={deleteSavedTeam}
                      fields={{ savedTeamId: team.id }}
                      label="Eliminar"
                      variant="danger"
                      confirm={`¿Eliminar "${team.name}"? Tus inscripciones ya hechas no se tocan.`}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {myEntries.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Mis inscripciones</h2>
          <ul className="space-y-2">
            {myEntries.map((entry) => {
              const tournament = tournamentById.get(entry.tournament_id);
              if (!tournament) return null;

              return (
                <li key={entry.id}>
                  <Link
                    href={`/torneos/${tournament.slug}`}
                    className="card flex flex-wrap items-center gap-3 px-4 py-3 transition hover:border-brand/60"
                  >
                    <span className="font-medium">{tournament.name}</span>
                    <span className="text-sm text-ink-dim">con {entry.name}</span>
                    <span className="font-mono text-xs text-ink-faint">
                      cupo #{entry.seed}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      {entry.status === "eliminated" ? (
                        <Badge tone="bad">Eliminado</Badge>
                      ) : null}
                      <TournamentBadge status={tournament.status} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
