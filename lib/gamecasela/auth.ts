import "server-only";

/**
 * La API de gamecasela autentica con un idToken anónimo de Firebase (proyecto
 * `gamecasela`) enviado en el header `token`. El idToken vive ~1 h, así que el
 * servidor genera uno la primera vez y lo refresca cuando se acerca a caducar.
 *
 * Se requiere la Web API key pública de Firebase del proyecto (la misma que va
 * embebida en el bundle del frontend), vía GAMECASELA_FIREBASE_API_KEY.
 */

const IDENTITY_TOOLKIT = "https://identitytoolkit.googleapis.com/v1/accounts:signUp";
const SECURE_TOKEN = "https://securetoken.googleapis.com/v1/token";
const TIMEOUT_MS = 8_000;

/** Margen para refrescar antes del `exp` real y no cortarlo por los pelos. */
const EXPIRY_SKEW_MS = 60_000;

interface CachedToken {
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Caché en memoria del proceso. En serverless cada instancia mantiene la suya;
 * peor caso, cada instancia hace un signUp anónimo extra. No se persiste porque
 * el idToken es efímero y barato de regenerar.
 */
let cache: CachedToken | null = null;
/** Evita una estampida de signUp/refresh cuando llegan consultas en paralelo. */
let inflight: Promise<CachedToken> | null = null;

export class GamecaselaAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GamecaselaAuthError";
  }
}

function apiKey(): string {
  const key = process.env.GAMECASELA_FIREBASE_API_KEY;
  if (!key) {
    throw new GamecaselaAuthError(
      "Falta GAMECASELA_FIREBASE_API_KEY en el entorno",
    );
  }
  return key;
}

/** Segundos de vida del token → instante absoluto de expiración con margen. */
function expiryFromLifetime(expiresInSeconds: string | number): number {
  const seconds = Number(expiresInSeconds);
  const lifetime = Number.isFinite(seconds) ? seconds * 1000 : 3_600_000;
  return Date.now() + lifetime - EXPIRY_SKEW_MS;
}

async function signUpAnonymous(): Promise<CachedToken> {
  const response = await fetch(`${IDENTITY_TOOLKIT}?key=${apiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof payload.idToken !== "string") {
    const message =
      ((payload.error as Record<string, unknown>)?.message as string) ??
      `HTTP ${response.status}`;
    throw new GamecaselaAuthError(`No se pudo iniciar sesión anónima: ${message}`);
  }

  return {
    idToken: payload.idToken,
    refreshToken: String(payload.refreshToken ?? ""),
    expiresAt: expiryFromLifetime(payload.expiresIn as string),
  };
}

async function refresh(refreshToken: string): Promise<CachedToken> {
  const response = await fetch(`${SECURE_TOKEN}?key=${apiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const idToken = payload.id_token;
  if (!response.ok || typeof idToken !== "string") {
    // Refresh caducado/revocado: se cae a un signUp nuevo.
    return signUpAnonymous();
  }

  return {
    idToken,
    refreshToken: String(payload.refresh_token ?? refreshToken),
    expiresAt: expiryFromLifetime(payload.expires_in as string),
  };
}

async function obtain(): Promise<CachedToken> {
  if (cache && !cache.refreshToken) return signUpAnonymous();
  if (cache?.refreshToken) return refresh(cache.refreshToken);
  return signUpAnonymous();
}

/**
 * Devuelve un idToken válido, reusando el cacheado mientras no caduque.
 * Serializa las regeneraciones concurrentes en una sola llamada.
 */
export async function getIdToken(): Promise<string> {
  if (cache && Date.now() < cache.expiresAt) return cache.idToken;

  if (!inflight) {
    inflight = obtain()
      .then((fresh) => {
        cache = fresh;
        return fresh;
      })
      .finally(() => {
        inflight = null;
      });
  }

  return (await inflight).idToken;
}

/** Descarta el token cacheado; la próxima consulta generará uno nuevo. */
export function invalidateToken(): void {
  cache = null;
}

export const __testing = { expiryFromLifetime };
