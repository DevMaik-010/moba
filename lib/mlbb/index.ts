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

/** Techo por IP en el registro, donde todavía no hay usuario al que cobrarle. */
const SIGNUP_RATE_LIMIT = { max: 10, windowMs: 60 * 60 * 1000 };

/** Techo global del registro: respaldo si alguien rota o falsea IPs. */
const SIGNUP_GLOBAL_LIMIT = 300;

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

/**
 * Descuenta una consulta a proveedores externos del cupo del usuario, o lanza
 * RateLimitError si ya lo agotó. Toda ruta que consulte a un proveedor pasa por
 * aquí, para que el servidor no sirva de proxy ilimitado.
 */
export async function consumeLookupQuota(
  profileId: string,
  gameUserId: string,
  zoneId: string,
): Promise<void> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - RATE_LIMIT.windowMs).toISOString();

  const { count } = await admin
    .from("mlbb_lookup_log")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .gte("created_at", since);

  if ((count ?? 0) >= RATE_LIMIT.max) throw new RateLimitError();

  await admin.from("mlbb_lookup_log").insert({
    profile_id: profileId,
    game_user_id: gameUserId,
    zone_id: zoneId,
  });
}

/** Igual que consumeLookupQuota, pero por IP: para el formulario de registro. */
async function consumeSignupQuota(ip: string): Promise<void> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - SIGNUP_RATE_LIMIT.windowMs).toISOString();

  const [{ count }, { count: total }] = await Promise.all([
    admin
      .from("mlbb_signup_lookup_log")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", since),
    admin
      .from("mlbb_signup_lookup_log")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since),
  ]);

  if ((count ?? 0) >= SIGNUP_RATE_LIMIT.max || (total ?? 0) >= SIGNUP_GLOBAL_LIMIT) {
    throw new RateLimitError();
  }

  await admin.from("mlbb_signup_lookup_log").insert({ ip });
}

/** caché → (cupo) → proveedores → caché. */
async function lookup(
  gameUserId: string,
  zoneId: string,
  consumeQuota: () => Promise<void>,
): Promise<MlbbLookupResult> {
  const cached = await readCache(gameUserId, zoneId);
  if (cached) return cached;

  await consumeQuota();

  let last: MlbbLookupResult = { status: "unavailable", provider: "ninguno" };

  for (const provider of PROVIDERS) {
    const result = await provider.lookup(gameUserId, zoneId);
    last = result;
    if (result.status !== "unavailable") break;
    // `unavailable` no se cachea: sin este log no queda rastro de por qué falló.
    console.warn(
      `[mlbb] ${provider.name} sin respuesta para ${gameUserId} (${zoneId}):`,
      JSON.stringify(result.raw),
    );
  }

  await writeCache(gameUserId, zoneId, last);
  return last;
}

/**
 * Busca una cuenta MLBB con el cupo del usuario.
 * Solo para uso en servidor; nunca la llames desde el navegador.
 */
export function lookupMlbbAccount(
  gameUserId: string,
  zoneId: string,
  profileId: string,
): Promise<MlbbLookupResult> {
  return lookup(gameUserId, zoneId, () => consumeLookupQuota(profileId, gameUserId, zoneId));
}

/** Busca una cuenta MLBB durante el registro, con el cupo de la IP. */
export function lookupMlbbAccountForSignup(
  gameUserId: string,
  zoneId: string,
  ip: string,
): Promise<MlbbLookupResult> {
  return lookup(gameUserId, zoneId, () => consumeSignupQuota(ip));
}

/**
 * Busca una cuenta MLBB sin descontar cupo. Solo para el admin revisando la
 * cola de validaciones: el que llama tiene que haber comprobado el rol.
 */
export function lookupMlbbAccountAsAdmin(
  gameUserId: string,
  zoneId: string,
): Promise<MlbbLookupResult> {
  return lookup(gameUserId, zoneId, async () => {});
}

/** ¿Ya hay una cuenta con este ID de jugador? (service role: ignora RLS) */
export async function isGameAccountTaken(gameUserId: string, zoneId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("game_user_id", gameUserId)
    .eq("zone_id", zoneId);
  return (count ?? 0) > 0;
}

export interface ProviderDiagnosis extends MlbbLookupResult {
  ms: number;
}

export interface MlbbDiagnosis {
  /** Fila de `mlbb_account_cache` tal cual, aunque haya caducado. */
  cache: Record<string, unknown> | null;
  /** Configuración del servidor que responde, para comparar local con producción. */
  env: { gamecaselaKey: boolean; region: string | null };
  /** Perfil que ya tiene este ID, si lo hay. */
  takenBy: { id: string; display_name: string; mlbb_status: string | null } | null;
  providers: ProviderDiagnosis[];
}

/**
 * Consulta TODOS los proveedores sin caché ni cupo y sin escribir nada, para
 * que el admin vea por qué un ID no se resuelve. El que llama tiene que haber
 * comprobado el rol.
 */
export async function diagnoseMlbbAccount(
  gameUserId: string,
  zoneId: string,
): Promise<MlbbDiagnosis> {
  const admin = createAdminClient();

  const [{ data: cache }, { data: taken }, providers] = await Promise.all([
    admin
      .from("mlbb_account_cache")
      .select("*")
      .eq("game_user_id", gameUserId)
      .eq("zone_id", zoneId)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("id, display_name, mlbb_status")
      .eq("game_user_id", gameUserId)
      .eq("zone_id", zoneId)
      .maybeSingle(),
    Promise.all(
      PROVIDERS.map(async (provider): Promise<ProviderDiagnosis> => {
        const start = Date.now();
        try {
          const result = await provider.lookup(gameUserId, zoneId);
          return { ...result, ms: Date.now() - start };
        } catch (error) {
          return {
            status: "unavailable",
            provider: provider.name,
            raw: { thrown: String(error) },
            ms: Date.now() - start,
          };
        }
      }),
    ),
  ]);

  return {
    env: {
      gamecaselaKey: Boolean(process.env.GAMECASELA_FIREBASE_API_KEY),
      region: process.env.VERCEL_REGION ?? process.env.FLY_REGION ?? null,
    },
    cache: (cache as Record<string, unknown> | null) ?? null,
    takenBy: (taken as MlbbDiagnosis["takenBy"]) ?? null,
    providers,
  };
}
