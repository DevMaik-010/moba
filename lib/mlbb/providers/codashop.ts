import type { MlbbLookupResult, MlbbProvider } from "@/lib/mlbb/types";

/**
 * Codashop no publica una API: esto consume el endpoint de inicio de pago, que
 * de paso valida la cuenta. Es el único proveedor que responde de forma fiable
 * hoy (api.isan.eu.org devuelve 500 y yanjiestore 403).
 *
 * Puede romperse sin aviso. Cuando eso pase devuelve `unavailable` y el ID cae
 * a la cola manual del admin en vez de bloquear la inscripción.
 *
 * Respuesta observada con un ID inexistente:
 *   {"success":false,"errorCode":1003,"errorMsg":"1003: Error_Role_Null"}
 */

const ENDPOINT =
  process.env.MLBB_CODASHOP_ENDPOINT ?? "https://order-sg.codashop.com/initPayment.action";

/** Punto de precio arbitrario: solo se usa para que el endpoint acepte la consulta. */
const PRICE_POINT_ID = process.env.MLBB_CODASHOP_PRICE_POINT ?? "142553";
const TIMEOUT_MS = 8_000;

/** El rol no existe: la cuenta es inválida, no es una caída del proveedor. */
const ROLE_NULL_ERROR = 1003;

function decodeNickname(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " ")).trim();
  } catch {
    return value.trim();
  }
}

/**
 * Codashop ha movido el nickname de sitio entre versiones, así que se buscan
 * varias rutas conocidas antes de rendirse.
 */
function extractNickname(payload: Record<string, unknown>): string | undefined {
  const confirmation = payload.confirmationFields as Record<string, unknown> | undefined;

  const candidates = [
    confirmation?.roles,
    confirmation?.username,
    confirmation?.roleName,
    payload.roleName,
    payload.username,
    payload.result,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return decodeNickname(candidate);
    }
    if (Array.isArray(candidate) && candidate.length > 0) {
      const first = candidate[0];
      if (typeof first === "string") return decodeNickname(first);
      if (first && typeof first === "object") {
        const role = (first as Record<string, unknown>).role;
        if (typeof role === "string") return decodeNickname(role);
      }
    }
  }

  return undefined;
}

export const codashopProvider: MlbbProvider = {
  name: "codashop",

  async lookup(gameUserId, zoneId): Promise<MlbbLookupResult> {
    const body = {
      "voucherPricePoint.id": PRICE_POINT_ID,
      "voucherPricePoint.price": "1.55",
      "voucherPricePoint.variablePrice": "0",
      "user.userId": gameUserId,
      "user.zoneId": zoneId,
      voucherTypeName: "MOBILE_LEGENDS",
      shopLang: "en_PH",
    };

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      return { status: "unavailable", provider: this.name, raw: { error: String(error) } };
    }

    if (!response.ok) {
      return {
        status: "unavailable",
        provider: this.name,
        raw: { httpStatus: response.status },
      };
    }

    let payload: Record<string, unknown>;
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      // Un HTML de Cloudflare en vez de JSON significa bloqueo, no ID inválido.
      return { status: "unavailable", provider: this.name, raw: { parse: "not-json" } };
    }

    if (payload.success === true) {
      return {
        status: "valid",
        nickname: extractNickname(payload),
        provider: this.name,
        raw: payload,
      };
    }

    if (payload.errorCode === ROLE_NULL_ERROR) {
      return { status: "invalid", provider: this.name, raw: payload };
    }

    // Cualquier otro error es del proveedor, no de la cuenta.
    return { status: "unavailable", provider: this.name, raw: payload };
  },
};

export const __testing = { extractNickname, decodeNickname };
