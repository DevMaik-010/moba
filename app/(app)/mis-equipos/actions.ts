"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { lookupMlbbAccount, RateLimitError } from "@/lib/mlbb";
import { mlbbIdSchema } from "@/lib/mlbb/types";
import { safeReturnPath } from "@/lib/navigation";
import { createClient, getSession } from "@/lib/supabase/server";
import { TEAM_SIZE_BY_MODE } from "@/lib/db/types";
import { TEAM_LOGO_BUCKET } from "@/lib/team-logo";

export interface SavedTeamFormState {
  error?: string;
  notice?: string;
}

const teamSchema = z.object({
  name: z.string().trim().min(2, "El nombre del equipo es muy corto").max(40),
  tag: z.string().trim().max(6, "El tag admite hasta 6 caracteres").default(""),
  mode: z.enum(["1v1", "3v3", "5v5"]),
  // Los integrantes además del capitán (vacío en 1v1).
  members: z.array(mlbbIdSchema),
});

/**
 * Lee las filas `member-<i>-id` / `member-<i>-zone` del formulario, de la 1 a
 * la size-1: la 0 es el capitán y sale de la cuenta, no del formulario.
 */
function readMembers(formData: FormData, size: number) {
  return Array.from({ length: size - 1 }, (_, n) => {
    const i = n + 1;
    return {
      gameUserId: String(formData.get(`member-${i}-id`) ?? "").trim(),
      zoneId: String(formData.get(`member-${i}-zone`) ?? "").trim(),
    };
  });
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

  const { profile } = session;
  if (!profile.game_user_id || !profile.zone_id) {
    return { error: "Registra tu ID de jugador en Mi perfil antes de armar un equipo" };
  }
  const captain = { gameUserId: profile.game_user_id, zoneId: profile.zone_id };

  const { name, tag, members: others } = parsed.data;
  const members = [captain, ...others];

  const seen = new Set<string>();
  for (const m of members) {
    const key = `${m.gameUserId}:${m.zoneId}`;
    if (seen.has(key)) {
      return {
        error:
          key === `${captain.gameUserId}:${captain.zoneId}`
            ? "Tú ya eres el capitán: no te agregues otra vez como integrante"
            : `El ID ${m.gameUserId} (${m.zoneId}) está repetido en el roster`,
      };
    }
    seen.add(key);
  }

  for (const member of others) {
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
  const { data: savedId, error } = await supabase.rpc("upsert_saved_team", {
    p_saved_team_id: savedTeamId,
    p_name: name,
    p_tag: tag,
    p_mode: mode,
    p_members: members.map((m, index) => ({ slot: index + 1, ...m })),
  });
  if (error) return { error: error.message };

  // Logo opcional elegido al crear: el navegador ya lo subió a su carpeta.
  const logoPath = String(formData.get("logoPath") ?? "") || null;
  if (!savedTeamId && logoPath && savedId) {
    const { error: logoError } = await supabase.rpc("set_saved_team_logo", {
      p_saved_team_id: savedId,
      p_path: logoPath,
    });
    if (logoError) {
      // El equipo ya existe: el logo se puede volver a subir desde "Editar".
      console.error("[mis-equipos] no se pudo guardar el logo:", logoError.message);
      await supabase.storage.from(TEAM_LOGO_BUCKET).remove([logoPath]);
    }
  }

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

/**
 * Fija (o quita, con `path` vacío) el logo de un equipo guardado. El archivo ya
 * lo subió el navegador al bucket, dentro de la carpeta del usuario; la RPC
 * comprueba dueño y carpeta, y propaga el logo a las inscripciones vivas.
 */
export async function setSavedTeamLogo(
  savedTeamId: string,
  path: string | null,
): Promise<SavedTeamFormState> {
  const session = await getSession();
  if (!session) return { error: "Necesitas iniciar sesión" };

  const supabase = await createClient();
  const { data: previous, error } = await supabase.rpc("set_saved_team_logo", {
    p_saved_team_id: savedTeamId,
    p_path: path,
  });

  if (error) {
    // El archivo recién subido quedaría huérfano.
    if (path) await supabase.storage.from(TEAM_LOGO_BUCKET).remove([path]);
    return { error: error.message };
  }

  // El logo anterior puede seguir mostrándose en torneos ya cerrados: solo se
  // borra si ninguna inscripción lo usa.
  if (previous && previous !== path) {
    const { count } = await supabase
      .from("teams")
      .select("id", { count: "exact", head: true })
      .eq("logo_path", previous);
    if (!count) await supabase.storage.from(TEAM_LOGO_BUCKET).remove([previous]);
  }

  revalidatePath("/mis-equipos");
  revalidatePath(`/mis-equipos/${savedTeamId}`);
  revalidatePath("/torneos", "layout");
  return { notice: path ? "Logo actualizado" : "Logo eliminado" };
}

/**
 * Reintenta la verificación automática de los IDs pendientes de un equipo
 * guardado (proveedor caído la primera vez). El veredicto queda en la caché y
 * la RPC lo copia al roster.
 */
export async function retrySavedTeamValidation(
  _prev: SavedTeamFormState,
  formData: FormData,
): Promise<SavedTeamFormState> {
  const session = await getSession();
  if (!session) return { error: "Necesitas iniciar sesión" };

  const savedTeamId = String(formData.get("savedTeamId") ?? "");
  const supabase = await createClient();

  // RLS: solo devuelve filas de equipos propios.
  const { data: pending } = await supabase
    .from("saved_team_members")
    .select("game_user_id, zone_id")
    .eq("saved_team_id", savedTeamId)
    .eq("validation_status", "pending");

  if (!pending || pending.length === 0) return { notice: "No hay IDs pendientes" };

  for (const member of pending) {
    try {
      await lookupMlbbAccount(member.game_user_id, member.zone_id, session.userId);
    } catch (error) {
      if (error instanceof RateLimitError) return { error: error.message };
      console.error("[mis-equipos] reintento de validación falló:", error);
    }
  }

  const { data: left, error } = await supabase.rpc("refresh_saved_team_validation", {
    p_saved_team_id: savedTeamId,
  });
  if (error) return { error: error.message };

  revalidatePath("/mis-equipos");
  revalidatePath("/torneos", "layout");
  const resolved = pending.length - (left ?? 0);
  return left
    ? {
        notice: `${resolved} de ${pending.length} resueltos. El verificador sigue sin responder para ${left}: un admin los revisará.`,
      }
    : { notice: "Listo: todos los IDs tienen veredicto" };
}
