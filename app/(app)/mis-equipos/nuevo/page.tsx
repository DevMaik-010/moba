import Link from "next/link";
import { redirect } from "next/navigation";

import { safeReturnPath } from "@/lib/navigation";
import { getSession } from "@/lib/supabase/server";
import { TEAM_SIZE_BY_MODE } from "@/lib/db/types";
import type { TournamentMode } from "@/lib/db/types";
import { TeamEditor } from "../team-editor";

export default async function NuevoEquipoPage({
  searchParams,
}: PageProps<"/mis-equipos/nuevo">) {
  const { modo, volver } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login?next=/mis-equipos/nuevo");

  const mode = typeof modo === "string" && modo in TEAM_SIZE_BY_MODE
    ? (modo as TournamentMode)
    : undefined;
  const returnTo = safeReturnPath(volver);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href={returnTo ?? "/mis-equipos"}
          className="text-sm text-ink-dim transition hover:text-ink"
        >
          ← Volver
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Nuevo equipo</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Lo armas una vez y lo inscribes con un clic en cada torneo de su modo.
        </p>
      </div>
      <TeamEditor defaultMode={mode} returnTo={returnTo} />
    </div>
  );
}
