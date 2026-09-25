import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { safeReturnPath } from "@/lib/navigation";
import { createClient, getSession } from "@/lib/supabase/server";
import type { SavedTeam, SavedTeamMember } from "@/lib/db/types";
import { TeamEditor } from "../team-editor";

export const dynamic = "force-dynamic";

export default async function EditarEquipoPage({
  params,
  searchParams,
}: PageProps<"/mis-equipos/[id]">) {
  const { id } = await params;
  const { volver } = await searchParams;
  const session = await getSession();
  if (!session) redirect(`/login?next=/mis-equipos/${id}`);

  const supabase = await createClient();
  const { data: team } = await supabase
    .from("saved_teams")
    .select("*")
    .eq("id", id)
    .eq("owner_id", session.userId)
    .maybeSingle<SavedTeam>();

  if (!team) notFound();

  const { data: members } = await supabase
    .from("saved_team_members")
    .select("*")
    .eq("saved_team_id", id)
    .order("slot");

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
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Editar {team.name}</h1>
      </div>
      <TeamEditor
        team={team}
        members={(members ?? []) as SavedTeamMember[]}
        returnTo={returnTo}
      />
    </div>
  );
}
