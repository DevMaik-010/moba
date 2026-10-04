import type { GameResolvedVia } from "@/lib/db/types";

/**
 * Cookie donde queda el código de inscripción de un equipo, una vez que alguien
 * lo ingresó bien. Es por torneo: el mismo código abre todos los
 * enfrentamientos de ese equipo. La página lo reenvía a get_match_room en cada
 * carga y la base de datos decide si da acceso a ese partido.
 */
export function teamCodeCookie(slug: string): string {
  return `team_code_${slug}`;
}

/** 8 caracteres sin 0/O ni 1/I; se aceptan minúsculas, espacios y guiones. */
export const TEAM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

export function normalizeTeamCode(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function matchPath(slug: string, matchId: string): string {
  return `/torneos/${slug}/partido/${matchId}`;
}

/** Cómo quedó registrada una partida, para mostrarlo junto al ganador. */
export function resolvedViaLabel(via: GameResolvedVia | null): string {
  if (via === "rival") return "confirmó el rival";
  if (via === "no_show") return "el rival no publicó la sala";
  return "admin";
}
