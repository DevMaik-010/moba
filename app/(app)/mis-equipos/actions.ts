"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { lookupMlbbAccount, RateLimitError } from "@/lib/mlbb";
import { mlbbIdSchema } from "@/lib/mlbb/types";
import { safeReturnPath } from "@/lib/navigation";
import { createClient, getSession } from "@/lib/supabase/server";
import { TEAM_SIZE_BY_MODE } from "@/lib/db/types";

export interface SavedTeamFormState {
  error?: string;
  notice?: string;
}

const teamSchema = z.object({
  name: z.string().trim().min(2, "El nombre del equipo es muy corto").max(40),
  tag: z.string().trim().max(6, "El tag admite hasta 6 caracteres").default(""),
  mode: z.enum(["1v1", "3v3", "5v5"]),
  members: z.array(mlbbIdSchema).min(1),
});

/** Lee las filas `member-<i>-id` / `member-<i>-zone` del formulario. */
function readMembers(formData: FormData, size: number) {
  return Array.from({ length: size }, (_, i) => ({
    gameUserId: String(formData.get(`member-${i}-id`) ?? "").trim(),
    zoneId: String(formData.get(`member-${i}-zone`) ?? "").trim(),
  }));
}

/**
 * Crea o edita un equipo guardado. Cada ID se consulta al verificador aquí para
 * dejar su veredicto en la caché; la base de datos toma el estado de ahí, nunca
 * del formulario.
 */
export async function saveSavedTeam(
  _prev: SavedTeamFormState,
  formData: FormData,
): Promise<SavedTeamFormState> {
  const session = await getSession();
  if (!session) return { error: "Necesitas iniciar sesión" };

  const mode = String(formData.get("mode") ?? "") as keyof typeof TEAM_SIZE_BY_MODE;
  const size = TEAM_SIZE_BY_MODE[mode];
  if (!size) return { error: "Elige un modo" };

  const parsed = teamSchema.safeParse({
    name: formData.get("name"),
    tag: formData.get("tag") ?? "",
    mode,
    members: readMembers(formData, size),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisa los datos del equipo" };
  }

  const { name, tag, members } = parsed.data;

  const seen = new Set<string>();
  for (const m of members) {
    const key = `${m.gameUserId}:${m.zoneId}`;
    if (seen.has(key)) {
      return { error: `El ID ${m.gameUserId} (${m.zoneId}) está repetido en el roster` };
    }
    seen.add(key);
  }

  for (const member of members) {
    try {
      await lookupMlbbAccount(member.gameUserId, member.zoneId, session.userId);
    } catch (error) {
      // Rate-limit, proveedor caído o falta la service role key: el ID queda
      // pendiente y lo revisa el admin. Nunca se rompe el guardado por esto.
      if (!(error instanceof RateLimitError)) {
        console.error("[mis-equipos] validación de ID no disponible:", error);
      }
    }
  }

  const savedTeamId = String(formData.get("savedTeamId") ?? "") || null;

  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_saved_team", {
    p_saved_team_id: savedTeamId,
    p_name: name,
    p_tag: tag,
    p_mode: mode,
    p_members: members.map((m, index) => ({ slot: index + 1, ...m })),
  });
  if (error) return { error: error.message };

  revalidatePath("/mis-equipos");
  redirect(safeReturnPath(formData.get("volver")) ?? "/mis-equipos");
}

export async function deleteSavedTeam(
  _prev: SavedTeamFormState,
  formData: FormData,
): Promise<SavedTeamFormState> {
  const session = await getSession();
  if (!session) return { error: "Necesitas iniciar sesión" };

  // RLS solo deja borrar los propios; las inscripciones ya hechas no se tocan.
  const supabase = await createClient();
  const { error } = await supabase
    .from("saved_teams")
    .delete()
    .eq("id", String(formData.get("savedTeamId")));
  if (error) return { error: error.message };

  revalidatePath("/mis-equipos");
  return { notice: "Equipo eliminado" };
}
