import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ActionForm } from "@/components/admin/action-form";
import { ValidationBadge } from "@/components/ui/badge";
import { TeamLogo } from "@/components/ui/team-logo";
import { accountBlocker, accountState } from "@/lib/account";
import { createClient, getSession } from "@/lib/supabase/server";
import type { SavedTeam, SavedTeamMember, Team, Tournament } from "@/lib/db/types";
import { retrySavedTeamValidation } from "@/app/(app)/mis-equipos/actions";
import { registerSavedTeam } from "./actions";

export const dynamic = "force-dynamic";

const REJECTED = new Set(["invalid", "manual_rejected"]);

export default async function InscribirPage({
  params,
}: PageProps<"/torneos/[slug]/inscribir">) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=/torneos/${slug}/inscribir`);

  const supabase = await createClient();
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<Tournament>();

  if (!tournament) notFound();

  const [{ data: entry }, { data: saved }, { count: registered }, { data: myEntries }] =
    await Promise.all([
    supabase
      .from("teams")
      .select("*")
      .eq("tournament_id", tournament.id)
      .eq("captain_id", session.userId)
      .not("seed", "is", null)
      .maybeSingle<Team>(),
    supabase
      .from("saved_teams")
      .select("*")
      .eq("owner_id", session.userId)
      .eq("mode", tournament.mode)
      .order("updated_at", { ascending: false }),
    supabase
      .from("teams")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", tournament.id)
      .not("seed", "is", null),
    // Inscripciones vigentes del capitán en otros torneos.
    supabase
      .from("teams")
      .select("*")
      .eq("captain_id", session.userId)
      .eq("status", "registered")
      .neq("tournament_id", tournament.id)
      .not("seed", "is", null),
  ]);

  const otherIds = ((myEntries ?? []) as Team[]).map((t) => t.tournament_id);
  const { data: activeElsewhere } =
    otherIds.length > 0
      ? await supabase
          .from("tournaments")
          .select("*")
          .in("id", otherIds)
          .in("status", ["open", "locked", "running"])
          .limit(1)
          .maybeSingle<Tournament>()
      : { data: null };

  const blocker = accountBlocker(accountState(session.profile));

  // RLS: solo el capitán lee el código de su inscripción.
  const { data: entryCode } = entry
    ? await supabase
        .from("team_access_codes")
        .select("code")
        .eq("team_id", entry.id)
        .maybeSingle<{ code: string }>()
    : { data: null };

  const teams = (saved ?? []) as SavedTeam[];
  const { data: members } =
    teams.length > 0
      ? await supabase
          .from("saved_team_members")
          .select("*")
          .in("saved_team_id", teams.map((t) => t.id))
          .order("slot")
      : { data: [] };

  const here = `/torneos/${slug}/inscribir`;
  const full = (registered ?? 0) >= tournament.bracket_size;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href={`/torneos/${slug}`}
          className="text-sm text-ink-dim transition hover:text-ink"
        >
          ← {tournament.name}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Inscribir equipo</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Torneo {tournament.mode} · {registered ?? 0}/{tournament.bracket_size} cupos ocupados
        </p>
      </div>

      {entry ? (
        <div className="card p-6">
          <h2 className="font-semibold">Ya estás inscrito con {entry.name}</h2>
          <p className="mt-1 text-sm text-ink-dim">
            Tienes el cupo #{entry.seed}. El roster quedó congelado al inscribirte; si
            necesitas un cambio, háblalo con el administrador del torneo.
          </p>
          {entryCode ? (
            <div className="mt-4 rounded-lg border border-brand/40 bg-brand/5 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">
                Código de inscripción
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tracking-[0.3em]">
                {entryCode.code}
              </p>
              <p className="mt-2 text-sm text-ink-dim">
                Es único de tu equipo en este torneo. Te lo pediremos para entrar a cada
                enfrentamiento del cuadro: compártelo solo con tus jugadores.
              </p>
            </div>
          ) : null}
        </div>
      ) : tournament.status === "open" && !full && (blocker || activeElsewhere) ? (
        <div className="card space-y-3 p-6">
          <h2 className="font-semibold">Todavía no puedes inscribirte</h2>
          {blocker ? (
            <p className="text-sm text-ink-dim">
              {blocker}{" "}
              <Link href="/perfil" className="font-semibold text-brand hover:brightness-125">
                Ir a Mi perfil
              </Link>
            </p>
          ) : null}
          {activeElsewhere ? (
            <p className="text-sm text-ink-dim">
              Ya tienes una inscripción activa en{" "}
              <Link
                href={`/torneos/${activeElsewhere.slug}`}
                className="font-semibold text-brand hover:brightness-125"
              >
                {activeElsewhere.name}
              </Link>
              . Solo se puede estar en un torneo a la vez: podrás inscribirte aquí cuando ese
              termine o tu equipo quede eliminado.
            </p>
          ) : null}
        </div>
      ) : tournament.status !== "open" || full ? (
        <div className="card p-6 text-sm text-ink-dim">
          {full || tournament.status === "locked"
            ? "Los cupos se llenaron y las inscripciones están cerradas."
            : "Las inscripciones de este torneo no están abiertas."}
        </div>
      ) : (
        <>
          {teams.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-ink-dim">
                No tienes ningún equipo {tournament.mode} todavía.
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {teams.map((team) => {
                const roster = ((members ?? []) as SavedTeamMember[]).filter(
                  (m) => m.saved_team_id === team.id,
                );
                const rejected = roster.filter((m) => REJECTED.has(m.validation_status)).length;
                const pendingIds = roster.filter((m) => m.validation_status === "pending").length;

                return (
                  <li key={team.id} className="card space-y-4 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <TeamLogo name={team.name} tag={team.tag} path={team.logo_path} size={32} />
                      <h2 className="font-semibold">{team.name}</h2>
                      {team.tag ? (
                        <span className="font-mono text-xs text-ink-faint">[{team.tag}]</span>
                      ) : null}
                    </div>

                    <ul className="space-y-1.5">
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

                    {rejected > 0 ? (
                      <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
                        Hay {rejected} ID rechazado. Edita el equipo para corregirlo.
                      </p>
                    ) : null}

                    {pendingIds > 0 ? (
                      <div className="flex flex-wrap items-start gap-3 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2">
                        <p className="min-w-0 flex-1 text-sm text-warn">
                          {pendingIds === 1
                            ? "1 ID sin verificar. Puedes inscribirte igual (lo revisa un admin) o reintentar ahora."
                            : `${pendingIds} IDs sin verificar. Puedes inscribirte igual (los revisa un admin) o reintentar ahora.`}
                        </p>
                        <ActionForm
                          action={retrySavedTeamValidation}
                          fields={{ savedTeamId: team.id }}
                          label="Reintentar verificación"
                          showNotice
                        />
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-start gap-3">
                      <ActionForm
                        action={registerSavedTeam}
                        fields={{ savedTeamId: team.id, tournamentId: tournament.id, slug }}
                        label="Inscribir este equipo"
                        variant="primary"
                        disabled={rejected > 0}
                        confirm={`Se inscribe "${team.name}" con este roster y ya no se podrá cambiar en este torneo. ¿Continuar?`}
                      />
                      <Link
                        href={`/mis-equipos/${team.id}?volver=${encodeURIComponent(here)}`}
                        className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-dim transition hover:border-brand hover:text-ink"
                      >
                        Editar integrantes
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <Link
            href={`/mis-equipos/nuevo?modo=${tournament.mode}&volver=${encodeURIComponent(here)}`}
            className="block rounded-lg border border-dashed border-line px-4 py-3 text-center text-sm text-ink-dim transition hover:border-brand hover:text-ink"
          >
            + Armar un equipo {tournament.mode} nuevo
          </Link>
        </>
      )}
    </div>
  );
}
