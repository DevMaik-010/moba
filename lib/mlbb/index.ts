import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { gamecaselaProvider } from "@/lib/mlbb/providers/gamecasela";
import { codashopProvider } from "@/lib/mlbb/providers/codashop";
import type { MlbbLookupResult, MlbbProvider } from "@/lib/mlbb/types";
import type { ValidationStatus } from "@/lib/db/types";

/**
 * Cadena de proveedores. Se recorre en orden hasta que uno dé un veredicto
 * (`valid` o `invalid`); si todos fallan, el resultado es `unavailable` y el ID
 * queda pendiente de revisión manual. gamecasela va primero por ser el más
 * fiable hoy; codashop queda de respaldo.
 */
const PROVIDERS: MlbbProvider[] = [gamecaselaProvider, codashopProvider];

/** Una cuenta validada no cambia de nombre a menudo; una semana es suficiente. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Techo por usuario para no quemar la IP del servidor contra el proveedor. */
const RATE_LIMIT = { max: 20, windowMs: 60 * 60 * 1000 };

export class RateLimitError extends Error {
  constructor() {
    super("Demasiadas consultas de ID. Espera un rato antes de seguir.");
    this.name = "RateLimitError";
  }
}

export function toValidationStatus(result: MlbbLookupResult): ValidationStatus {
  switch (result.status) {
    case "valid":
      return "valid";
    case "invalid":
      return "invalid";
    default:
      return "pending";
  }
}

async function readCache(
  gameUserId: string,
  zoneId: string,
): Promise<MlbbLookupResult | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("mlbb_account_cache")
    .select("*")
    .eq("game_user_id", gameUserId)
    .eq("zone_id", zoneId)
    .maybeSingle();

  if (!data) return null;

  // El veredicto de un admin no caduca: nadie lo va a revisar dos veces.
  const manual = data.status === "manual_ok" || data.status === "manual_rejected";
  if (!manual && Date.now() - new Date(data.checked_at).getTime() > CACHE_TTL_MS) return null;
  // Un `pending` cacheado sería recordar que el proveedor estaba caído. Se reintenta.
  if (data.status === "pending") return null;

  return {
    status: data.status === "valid" || data.status === "manual_ok" ? "valid" : "invalid",
    nickname: data.nickname ?? undefined,
    provider: `${data.provider} (caché)`,
  };
}

async function writeCache(
  gameUserId: string,
  zoneId: string,
  result: MlbbLookupResult,
): Promise<void> {
  if (result.status === "unavailable") return;

  const admin = createAdminClient();
  await admin.from("mlbb_account_cache").upsert({
    game_user_id: gameUserId,
    zone_id: zoneId,
    nickname: result.nickname ?? null,
    status: result.status === "valid" ? "valid" : "invalid",
    provider: result.provider,
    raw: result.raw ?? null,
    checked_at: new Date().toISOString(),
  });
}

async function enforceRateLimit(profileId: string): Promise<void> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - RATE_LIMIT.windowMs).toISOString();

  const { count } = await admin
    .from("mlbb_lookup_log")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .gte("created_at", since);

  if ((count ?? 0) >= RATE_LIMIT.max) throw new RateLimitError();
}

/**
 * Busca una cuenta MLBB: caché → proveedores → caché.
 * Solo para uso en servidor; nunca la llames desde el navegador.
 */
export async function lookupMlbbAccount(
  gameUserId: string,
  zoneId: string,
  profileId: string,
): Promise<MlbbLookupResult> {
  const cached = await readCache(gameUserId, zoneId);
  if (cached) return cached;

  await enforceRateLimit(profileId);

  const admin = createAdminClient();
  await admin.from("mlbb_lookup_log").insert({
    profile_id: profileId,
    game_user_id: gameUserId,
    zone_id: zoneId,
  });

  let last: MlbbLookupResult = { status: "unavailable", provider: "ninguno" };

  for (const provider of PROVIDERS) {
    const result = await provider.lookup(gameUserId, zoneId);
    last = result;
    if (result.status !== "unavailable") break;
  }

  await writeCache(gameUserId, zoneId, last);
  return last;
}
