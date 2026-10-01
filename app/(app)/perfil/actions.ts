"use server";

import { revalidatePath } from "next/cache";

import { lookupMlbbAccount, RateLimitError } from "@/lib/mlbb";
import { mlbbIdSchema } from "@/lib/mlbb/types";
import { createClient, getSession } from "@/lib/supabase/server";

export interface ProfileFormState {
  error?: string;
  notice?: string;
}

/**
 * Registra o corrige el ID de jugador de la cuenta. Se consulta al verificador
 * para dejar su veredicto en la caché; la RPC toma el estado de ahí.
 */
export async function saveGameAccount(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const session = await getSession();
  if (!session) return { error: "Necesitas iniciar sesión" };

  const parsed = mlbbIdSchema.safeParse({
    gameUserId: formData.get("gameUserId"),
    zoneId: formData.get("zoneId"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisa los datos" };
  }
  const { gameUserId, zoneId } = parsed.data;

  try {
    const result = await lookupMlbbAccount(gameUserId, zoneId, session.userId);
    if (result.status === "invalid") {
      return { error: "Ese ID de jugador no existe en ese servidor. Revisa los dos números." };
    }
  } catch (error) {
    if (error instanceof RateLimitError) return { error: error.message };
    // Proveedor caído o falta la service role key: queda en revisión.
    console.error("[perfil] validación de ID no disponible:", error);
  }

  const supabase = await createClient();
  const { data: status, error } = await supabase.rpc("set_my_game_account", {
    p_game_user_id: gameUserId,
    p_zone_id: zoneId,
  });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return {
    notice:
      status === "valid" || status === "manual_ok"
        ? "ID verificado. Ya puedes inscribirte en torneos."
        : "ID guardado. El verificador no respondió: un administrador lo revisará.",
  };
}
