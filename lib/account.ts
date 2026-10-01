import type { Profile } from "@/lib/db/types";

export type AccountState = "missing" | "pending" | "rejected" | "verified";

/** En qué punto está la verificación del ID de jugador de una cuenta. */
export function accountState(profile: Pick<Profile, "game_user_id" | "mlbb_status">): AccountState {
  if (!profile.game_user_id || !profile.mlbb_status) return "missing";
  switch (profile.mlbb_status) {
    case "valid":
    case "manual_ok":
      return "verified";
    case "invalid":
    case "manual_rejected":
      return "rejected";
    default:
      return "pending";
  }
}

/** Por qué una cuenta todavía no puede inscribirse, o null si puede. */
export function accountBlocker(state: AccountState): string | null {
  switch (state) {
    case "missing":
      return "Registra tu ID de jugador y servidor en Mi perfil para poder inscribirte.";
    case "rejected":
      return "Tu ID de jugador fue rechazado. Corrígelo en Mi perfil para poder inscribirte.";
    case "pending":
      return "Tu ID de jugador está en revisión. Podrás inscribirte cuando un administrador lo apruebe.";
    default:
      return null;
  }
}
