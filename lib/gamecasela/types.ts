import { z } from "zod";

/**
 * `unavailable` es distinto de `invalid`: el primero significa que la API de
 * gamecasela no contestó (caída, token rechazado, cambió el contrato) y la
 * cuenta queda sin verificar; el segundo, que la cuenta no existe.
 */
export type LookupStatus = "valid" | "invalid" | "unavailable";

export interface GamecaselaLookupResult {
  status: LookupStatus;
  /** Nombre de la cuenta devuelto por la API (`userName`). */
  userName?: string;
  /** Token de la validación exitosa (`uidGameData`); útil si luego se procesa. */
  uidGameData?: string;
  raw?: unknown;
}

/**
 * Entrada de validación. `uidGame` identifica el juego; `zoneId` es el
 * servidor/zona (opcional para juegos sin zona, p. ej. "0000"). `origen` es la
 * etiqueta de fuente que la API espera tanto en el query param como en el body.
 */
export const gamecaselaLookupSchema = z.object({
  userId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,32}$/, "ID de usuario inválido"),
  zoneId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{0,16}$/, "Zona inválida")
    .default(""),
  uidGame: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, "Identificador de juego inválido"),
  origen: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,32}$/, "Origen inválido")
    .default("DIRECTOC"),
});

export type GamecaselaLookup = z.infer<typeof gamecaselaLookupSchema>;
