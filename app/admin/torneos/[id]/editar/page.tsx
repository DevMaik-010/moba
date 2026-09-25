import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { updateTournament } from "@/app/admin/actions";
import { createClient } from "@/lib/supabase/server";
import type { Tournament } from "@/lib/db/types";
import { TournamentForm } from "../../tournament-form";

export const dynamic = "force-dynamic";

/** `YYYY-MM-DDTHH:mm` en hora local, que es lo que espera `datetime-local`. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function EditarTorneoPage({
  params,
}: PageProps<"/admin/torneos/[id]/editar">) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("*")
    .eq("id", id)
    .maybeSingle<Tournament>();

  if (!tournament) notFound();
  if (tournament.status === "finished" || tournament.status === "cancelled") {
    redirect(`/admin/torneos/${id}`);
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link
          href={`/admin/torneos/${id}`}
          className="text-sm text-ink-dim transition hover:text-ink"
        >
          ← {tournament.name}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Editar torneo</h1>
        <p className="mt-1 text-sm text-ink-dim">
          El enlace público (/torneos/{tournament.slug}) no cambia aunque renombres.
        </p>
      </div>
      <TournamentForm
        action={updateTournament}
        tournament={tournament}
        startsAtInput={toLocalInput(tournament.starts_at)}
      />
    </div>
  );
}
