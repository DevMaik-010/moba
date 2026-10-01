import type { Profile, ValidationStatus } from "@/lib/db/types";

/** El dueño de la cuenta: siempre es el capitán (jugador 1) de sus equipos. */
export interface CaptainInfo {
  ownerId: string;
  gameUserId: string;
  zoneId: string;
  nickname: string | null;
  status: ValidationStatus;
}

/** Datos del capitán a partir del perfil, o null si todavía no registró su ID. */
export function captainFromProfile(profile: Profile): CaptainInfo | null {
  if (!profile.game_user_id || !profile.zone_id || !profile.mlbb_status) return null;
  return {
    ownerId: profile.id,
    gameUserId: profile.game_user_id,
    zoneId: profile.zone_id,
    nickname: profile.mlbb_nickname,
    status: profile.mlbb_status,
  };
}

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
