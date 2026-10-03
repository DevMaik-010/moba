import { createTournament } from "@/app/admin/actions";
import { getSession } from "@/lib/supabase/server";
import { TournamentForm } from "../tournament-form";

export default async function NuevoTorneoPage() {
  // Ya resuelta por el layout de admin: getSession está memoizada.
  const session = await getSession();

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Nuevo torneo</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Se crea en borrador. El cuadro se dibuja cuando abras las inscripciones.
        </p>
      </div>
      <TournamentForm action={createTournament} draftOwnerId={session?.userId} />
    </div>
  );
}
