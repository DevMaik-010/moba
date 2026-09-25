import { z } from "zod";

/**
 * `unavailable` es distinto de `invalid`: el primero significa que el proveedor
 * no contestó (caído, rate-limit, cambió el contrato) y el ID pasa a la cola
 * manual del admin; el segundo, que la cuenta no existe.
 */
export type LookupStatus = "valid" | "invalid" | "unavailable";

export interface MlbbLookupResult {
  status: LookupStatus;
  nickname?: string;
  provider: string;
  raw?: unknown;
}

export interface MlbbProvider {
  readonly name: string;
  lookup(gameUserId: string, zoneId: string): Promise<MlbbLookupResult>;
}

/** IDs de MLBB: 5-12 dígitos de cuenta, 3-6 de zona/servidor. */
export const mlbbIdSchema = z.object({
  gameUserId: z
    .string()
    .trim()
    .regex(/^[0-9]{5,12}$/, "El ID de juego debe tener entre 5 y 12 dígitos"),
  zoneId: z
    .string()
    .trim()
    .regex(/^[0-9]{3,6}$/, "El ID de servidor (zona) debe tener entre 3 y 6 dígitos"),
});

export type MlbbId = z.infer<typeof mlbbIdSchema>;
