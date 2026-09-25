"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient, getSession } from "@/lib/supabase/server";

export interface RegisterFormState {
  error?: string;
  notice?: string;
}

/**
 * Inscribe uno de tus equipos guardados. La RPC copia el roster al torneo,
 * asigna el primer cupo libre y, si era el último, cierra las inscripciones.
 */
export async function registerSavedTeam(
  _prev: RegisterFormState,
  formData: FormData,
): Promise<RegisterFormState> {
  const session = await getSession();
  if (!session) return { error: "Necesitas iniciar sesión" };

  const slug = String(formData.get("slug") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("register_saved_team", {
    p_saved_team_id: String(formData.get("savedTeamId") ?? ""),
    p_tournament_id: String(formData.get("tournamentId") ?? ""),
  });
  if (error) return { error: error.message };

  revalidatePath(`/torneos/${slug}`);
  revalidatePath("/torneos");
  revalidatePath("/mis-equipos");
  redirect(`/torneos/${slug}`);
}
