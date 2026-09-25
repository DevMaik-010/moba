import "server-only";

import { getIdToken, invalidateToken, GamecaselaAuthError } from "@/lib/gamecasela/auth";
import type { GamecaselaLookup, GamecaselaLookupResult } from "@/lib/gamecasela/types";

/**
 * Cliente de la API de gamecasela para validar una cuenta de juego y obtener su
 * `userName`. Solo servidor: la consulta sale desde la IP del servidor con un
 * idToken anónimo de Firebase gestionado en `auth.ts`.
 *
 * Endpoint observado:
 *   POST https://apicloud.info.bo/v0/gameData/getUserNameByClient?<origen>
 *   header  token: <idToken de Firebase>
 *   body    { userId, zoneId, uidGame, origen }
 *   200 →   { userName, userId, zoneId, uidGame, uidGameData, ... }
 *   401 →   { message: "No autenticado", ... }  (token ausente/rechazado)
 */

const BASE_URL =
  process.env.GAMECASELA_API_URL ??
  "https://apicloud.info.bo/v0/gameData/getUserNameByClient";
const TIMEOUT_MS = 10_000;

async function callApi(
  input: GamecaselaLookup,
  token: string,
): Promise<Response> {
  const url = `${BASE_URL}?${encodeURIComponent(input.origen)}`;
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      token,
    },
    body: JSON.stringify({
      userId: input.userId,
      zoneId: input.zoneId,
      uidGame: input.uidGame,
      origen: input.origen,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
}

/**
 * Valida una cuenta y devuelve su nombre. Reintenta una vez con token nuevo si
 * la API responde 401 (token caducado entre el check de expiración y el uso).
 */
export async function lookupAccount(
  input: GamecaselaLookup,
): Promise<GamecaselaLookupResult> {
  let response: Response;
  try {
    response = await callApi(input, await getIdToken());

    if (response.status === 401) {
      invalidateToken();
      response = await callApi(input, await getIdToken());
    }
  } catch (error) {
    if (error instanceof GamecaselaAuthError) {
      return { status: "unavailable", raw: { auth: error.message } };
    }
    return { status: "unavailable", raw: { error: String(error) } };
  }

  if (response.status === 401) {
    return { status: "unavailable", raw: { httpStatus: 401 } };
  }
  if (!response.ok) {
    return { status: "unavailable", raw: { httpStatus: response.status } };
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    return { status: "unavailable", raw: { parse: "not-json" } };
  }

  const userName = typeof payload.userName === "string" ? payload.userName.trim() : "";
  if (userName === "") {
    // La API contestó pero sin nombre: cuenta inexistente o datos inválidos.
    return { status: "invalid", raw: payload };
  }

  return {
    status: "valid",
    userName,
    uidGameData:
      typeof payload.uidGameData === "string" ? payload.uidGameData : undefined,
    raw: payload,
  };
}
