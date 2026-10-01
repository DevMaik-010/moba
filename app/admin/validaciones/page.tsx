import Link from "next/link";

import { revalidateGameId } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Team, TeamMember, Tournament } from "@/lib/db/types";
import { ValidationRow } from "./validation-row";

export const dynamic = "force-dynamic";

export default async function ValidacionesPage() {
  const supabase = await createClient();

  const [{ data: pending }, { data: pendingProfiles }] = await Promise.all([
    supabase
      .from("team_members")
      .select("*")
      .eq("validation_status", "pending")
      .order("team_id"),
    supabase
      .from("profiles")
      .select("*")
      .eq("mlbb_status", "pending")
      .order("created_at"),
  ]);

  const accounts = (pendingProfiles ?? []) as Profile[];

  const members = (pending ?? []) as TeamMember[];

  const [{ data: teams }, { data: tournaments }] =
    members.length > 0
      ? await Promise.all([
          supabase
            .from("teams")
            .select("*")
            .in("id", [...new Set(members.map((m) => m.team_id))]),
          supabase
            .from("tournaments")
            .select("*")
            .in("id", [...new Set(members.map((m) => m.tournament_id))]),
        ])
      : [{ data: [] }, { data: [] }];

  const teamById = new Map(((teams ?? []) as Team[]).map((t) => [t.id, t]));
  const tournamentById = new Map(
    ((tournaments ?? []) as Tournament[]).map((t) => [t.id, t]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Validaciones pendientes</h1>
        <p className="mt-1 text-sm text-ink-dim">
          IDs que el verificador automático no pudo resolver (proveedor caído, bloqueado o
          con límite alcanzado). Primero <strong className="text-ink">revalida con el
          sistema</strong>; si sigue sin responder, confírmalos a mano pidiendo una captura
          del perfil.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Cuentas por revisar{" "}
          <span className="font-mono text-sm text-ink-faint">({accounts.length})</span>
        </h2>
        <p className="text-sm text-ink-dim">
          Usuarios cuyo ID de jugador no se pudo verificar al crear la cuenta. Hasta que
          los apruebes pueden armar equipos, pero no inscribirse.
        </p>
        {accounts.length === 0 ? (
          <div className="card p-6 text-center text-sm text-ink-dim">
            Ninguna cuenta pendiente.
          </div>
        ) : (
          <ul className="space-y-3">
            {accounts.map((account) => (
              <li key={account.id} className="card space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-mono font-semibold">
                    {account.game_user_id}
                    <span className="text-ink-faint"> · zona {account.zone_id}</span>
                  </span>
                  <span className="text-ink-dim">{account.display_name}</span>
                  <span className="ml-auto">
                    <ActionForm
                      action={revalidateGameId}
                      fields={{ gameUserId: account.game_user_id!, zoneId: account.zone_id! }}
                      label="Revalidar con el sistema"
                      variant="primary"
                      showNotice
                    />
                  </span>
                </div>
                <ValidationRow kind="profile" id={account.id} nickname={account.mlbb_nickname} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <h2 className="text-lg font-semibold">
        IDs de rosters{" "}
        <span className="font-mono text-sm text-ink-faint">({members.length})</span>
      </h2>

      {members.length === 0 ? (
        <div className="card p-10 text-center text-sm text-ink-dim">
          No hay nada pendiente. El verificador automático está resolviendo todo.
        </div>
      ) : (
        <ul className="space-y-3">
          {members.map((member) => {
            const team = teamById.get(member.team_id);
            const tournament = tournamentById.get(member.tournament_id);

            return (
              <li key={member.id} className="card space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-mono font-semibold">
                    {member.game_user_id}
                    <span className="text-ink-faint"> · zona {member.zone_id}</span>
                  </span>
                  {member.is_captain ? (
                    <span className="text-[11px] uppercase text-brand">capitán</span>
                  ) : null}
                  <span className="text-ink-dim">
                    {team?.name ?? "equipo desconocido"}
                  </span>
                  {tournament ? (
                    <Link
                      href={`/admin/torneos/${tournament.id}`}
                      className="text-xs text-ink-faint hover:text-brand"
                    >
                      {tournament.name}
                    </Link>
                  ) : null}
                  <span className="ml-auto">
                    <ActionForm
                      action={revalidateGameId}
                      fields={{ gameUserId: member.game_user_id, zoneId: member.zone_id }}
                      label="Revalidar con el sistema"
                      variant="primary"
                      showNotice
                    />
                  </span>
                </div>

                <ValidationRow id={member.id} nickname={member.nickname} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
