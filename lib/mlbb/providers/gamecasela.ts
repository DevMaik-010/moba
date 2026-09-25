import { lookupAccount } from "@/lib/gamecasela";
import type { MlbbLookupResult, MlbbProvider } from "@/lib/mlbb/types";

/**
 * Valida cuentas MLBB contra la API de gamecasela (getUserNameByClient), que
 * autentica con un token anónimo de Firebase gestionado en el servidor. En la
 * práctica responde más fiable que codashop, así que va primero en la cadena.
 *
 * El `uidGame` identifica a Mobile Legends dentro de gamecasela. Es un dato de
 * su catálogo, no el ID del jugador; se deja configurable por si cambia.
 */
const UID_GAME = process.env.GAMECASELA_MLBB_UID_GAME ?? "r1OLRLRiSK7PO504f2SA";

export const gamecaselaProvider: MlbbProvider = {
  name: "gamecasela",

  async lookup(gameUserId, zoneId): Promise<MlbbLookupResult> {
    const result = await lookupAccount({
      userId: gameUserId,
      zoneId,
      uidGame: UID_GAME,
      origen: "DIRECTOC",
    });

    if (result.status === "valid") {
      return {
        status: "valid",
        nickname: result.userName,
        provider: this.name,
        raw: result.raw,
      };
    }
    if (result.status === "invalid") {
      return { status: "invalid", provider: this.name, raw: result.raw };
    }
    // La API no respondió / token rechazado: cae al siguiente proveedor.
    return { status: "unavailable", provider: this.name, raw: result.raw };
  },
};
