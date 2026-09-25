import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import type { Team, TeamMember, Tournament } from "@/lib/db/types";
import { ValidationRow } from "./validation-row";

export const dynamic = "force-dynamic";

export default async function ValidacionesPage() {
  const supabase = await createClient();

  const { data: pending } = await supabase
    .from("team_members")
    .select("*")
    .eq("validation_status", "pending")
    .order("team_id");

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
          con límite alcanzado). Confírmalos a mano pidiendo una captura del perfil.
        </p>
      </div>

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
                </div>

                <ValidationRow memberId={member.id} nickname={member.nickname} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
