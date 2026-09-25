import { NextResponse } from "next/server";

import { lookupAccount } from "@/lib/gamecasela";
import { gamecaselaLookupSchema } from "@/lib/gamecasela/types";
import { getSession } from "@/lib/supabase/server";

/**
 * Valida una cuenta de juego contra la API de gamecasela y devuelve su
 * `userName`. Solo para usuarios con sesión: la consulta sale desde la IP del
 * servidor con un token anónimo de Firebase gestionado en el servidor.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Necesitas iniciar sesión" }, { status: 401 });
  }

  const parsed = gamecaselaLookupSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }

  const result = await lookupAccount(parsed.data);

  if (result.status === "unavailable") {
    return NextResponse.json(
      { error: "No se pudo validar la cuenta en este momento" },
      { status: 502 },
    );
  }

  if (result.status === "invalid") {
    return NextResponse.json(
      {
        status: "invalid",
        userName: null,
        error: "Cuenta no encontrada, verifica los datos",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    status: "valid",
    userId: parsed.data.userId,
    zoneId: parsed.data.zoneId,
    uidGame: parsed.data.uidGame,
    userName: result.userName,
    uidGameData: result.uidGameData ?? null,
  });
}
