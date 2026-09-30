"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { matchCodeCookie, matchPath } from "@/lib/match-access";
import { createClient, getSession } from "@/lib/supabase/server";

export interface MatchFormState {
  error?: string;
  notice?: string;
}

function readTarget(formData: FormData) {
  return {
    matchId: String(formData.get("matchId") ?? ""),
    slug: String(formData.get("slug") ?? ""),
  };
}

/** Verifica el código contra la base y, si abre la sala, lo guarda en una cookie. */
export async function enterMatch(
  _prev: MatchFormState,
  formData: FormData,
): Promise<MatchFormState> {
  const { matchId } = readTarget(formData);
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  if (!/^[0-9A-F]{8}$/.test(code)) {
    return { error: "El código tiene 8 caracteres (números y letras de la A a la F)" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_match_room", {
    p_match_id: matchId,
    p_code: code,
  });
  if (error || !data) return { error: "Partido inexistente" };
  if (!data.viewer) return { error: "Código incorrecto" };

  const cookieStore = await cookies();
  cookieStore.set(matchCodeCookie(matchId), code, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });

  // El slug sale de la base, no del formulario.
  redirect(matchPath(data.tournament.slug, matchId));
}

/** Acciones de capitán: requieren sesión; la RPC comprueba que sea el capitán correcto. */
async function captainRpc(
  formData: FormData,
  run: (
    supabase: Awaited<ReturnType<typeof createClient>>,
    matchId: string,
  ) => PromiseLike<{ error: { message: string } | null }>,
  notice: string,
): Promise<MatchFormState> {
  const session = await getSession();
  if (!session) return { error: "Necesitas iniciar sesión como capitán" };

  const { matchId, slug } = readTarget(formData);
  const supabase = await createClient();
  const { error } = await run(supabase, matchId);
  if (error) return { error: error.message };

  revalidatePath(matchPath(slug, matchId));
  revalidatePath(`/torneos/${slug}`);
  return { notice };
}

export async function postRoomId(
  _prev: MatchFormState,
  formData: FormData,
): Promise<MatchFormState> {
  const roomId = String(formData.get("roomId") ?? "").trim();
  return captainRpc(
    formData,
    (supabase, matchId) =>
      supabase.rpc("post_match_room", { p_match_id: matchId, p_room_id: roomId }),
    "ID de sala publicado",
  );
}

const scoreSchema = z.object({
  myScore: z.coerce.number().int().min(0).max(99),
  rivalScore: z.coerce.number().int().min(0).max(99),
});

export async function claimWin(
  _prev: MatchFormState,
  formData: FormData,
): Promise<MatchFormState> {
  const parsed = scoreSchema.safeParse({
    myScore: formData.get("myScore"),
    rivalScore: formData.get("rivalScore"),
  });
  if (!parsed.success) return { error: "Marcador inválido" };
  if (parsed.data.myScore <= parsed.data.rivalScore) {
    return { error: "Solo el equipo ganador reporta: tu marcador tiene que ser mayor" };
  }

  return captainRpc(
    formData,
    (supabase, matchId) =>
      supabase.rpc("claim_match_win", {
        p_match_id: matchId,
        p_my_score: parsed.data.myScore,
        p_rival_score: parsed.data.rivalScore,
      }),
    "Victoria reportada. Falta la verificación del admin.",
  );
}

export async function disputeClaim(
  _prev: MatchFormState,
  formData: FormData,
): Promise<MatchFormState> {
  const note = String(formData.get("note") ?? "").trim();
  if (note.length < 5) return { error: "Cuenta brevemente qué pasó" };

  return captainRpc(
    formData,
    (supabase, matchId) =>
      supabase.rpc("dispute_match_claim", { p_match_id: matchId, p_note: note }),
    "Disputa enviada al admin",
  );
}
