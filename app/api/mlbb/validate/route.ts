import { NextResponse } from "next/server";

import { lookupMlbbAccount, RateLimitError, toValidationStatus } from "@/lib/mlbb";
import { mlbbIdSchema } from "@/lib/mlbb/types";
import { getSession } from "@/lib/supabase/server";

/**
 * Valida un ID de MLBB. Solo para usuarios con sesión: la consulta sale desde
 * la IP del servidor y está limitada por usuario.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Necesitas iniciar sesión" }, { status: 401 });
  }

  const parsed = mlbbIdSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }

  const { gameUserId, zoneId } = parsed.data;

  try {
    const result = await lookupMlbbAccount(gameUserId, zoneId, session.userId);

    return NextResponse.json({
      gameUserId,
      zoneId,
      status: toValidationStatus(result),
      lookupStatus: result.status,
      nickname: result.nickname ?? null,
      provider: result.provider,
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    console.error("[mlbb/validate]", error);
    return NextResponse.json(
      { error: "No se pudo consultar el ID. Queda pendiente de revisión." },
      { status: 502 },
    );
  }
}
