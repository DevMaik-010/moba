"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  matchPath,
  normalizeTeamCode,
  TEAM_CODE_PATTERN,
  teamCodeCookie,
} from "@/lib/match-access";
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

/**
 * Verifica el código de inscripción contra la base y, si abre la sala, lo
 * guarda en una cookie del torneo para los próximos enfrentamientos del equipo.
 */
export async function enterMatch(
  _prev: MatchFormState,
  formData: FormData,
): Promise<MatchFormState> {
  const { matchId } = readTarget(formData);
  const code = normalizeTeamCode(formData.get("code"));
  if (!TEAM_CODE_PATTERN.test(code)) {
    return { error: "El código de inscripción tiene 8 letras y números" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_match_room", {
    p_match_id: matchId,
    p_code: code,
  });
  if (error || !data) return { error: "Partido inexistente" };
  if (!data.viewer) {
    return { error: "Ese código no corresponde a ninguno de los equipos de este enfrentamiento" };
  }

  const cookieStore = await cookies();
  cookieStore.set(teamCodeCookie(data.tournament.slug), code, {
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

/** El capitán (o el admin, que lo fuerza) pide el sorteo de quién crea la sala. */
export async function readyForDraw(
  _prev: MatchFormState,
  formData: FormData,
): Promise<MatchFormState> {
  return captainRpc(
    formData,
    (supabase, matchId) => supabase.rpc("ready_for_draw", { p_match_id: matchId }),
    "Listo. El sorteo empieza cuando el otro capitán también esté listo.",
  );
}

/** El capitán avisa que su equipo terminó la preparación de la partida. */
export async function markReady(
  _prev: MatchFormState,
  formData: FormData,
): Promise<MatchFormState> {
  return captainRpc(
    formData,
    (supabase, matchId) => supabase.rpc("mark_game_ready", { p_match_id: matchId }),
    "Tu equipo está listo",
  );
}

const claimSchema = z.object({
  matchId: z.string().uuid(),
  slug: z.string().min(1),
  screenshotPath: z.string().min(1).max(200),
});

/**
 * Reporta la victoria de la partida en curso. Se llama desde el cliente
 * después de subir la captura al bucket, con la ruta que devolvió.
 */
export async function claimGame(input: {
  matchId: string;
  slug: string;
  screenshotPath: string;
}): Promise<MatchFormState> {
  const parsed = claimSchema.safeParse(input);
  if (!parsed.success) return { error: "Falta la captura de pantalla" };

  const formData = new FormData();
  formData.set("matchId", parsed.data.matchId);
  formData.set("slug", parsed.data.slug);
  return captainRpc(
    formData,
    (supabase, matchId) =>
      supabase.rpc("claim_game_win", {
        p_match_id: matchId,
        p_screenshot_path: parsed.data.screenshotPath,
      }),
    "Victoria reportada. Falta que el rival la confirme o que el admin la verifique.",
  );
}

/** El capitán rival da por buena la victoria: queda registrada sin el admin. */
export async function confirmClaim(
  _prev: MatchFormState,
  formData: FormData,
): Promise<MatchFormState> {
  return captainRpc(
    formData,
    (supabase, matchId) => supabase.rpc("confirm_game_claim", { p_match_id: matchId }),
    "Resultado confirmado",
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
      supabase.rpc("dispute_game_claim", { p_match_id: matchId, p_note: note }),
    "Disputa enviada al admin",
  );
}

/** Acciones del admin desde la sala; las RPC comprueban que sea admin. */
async function adminRpc(
  formData: FormData,
  run: (
    supabase: Awaited<ReturnType<typeof createClient>>,
    matchId: string,
  ) => PromiseLike<{ error: { message: string } | null }>,
  notice: string,
): Promise<MatchFormState> {
  const session = await getSession();
  if (!session || session.profile.role !== "admin") {
    return { error: "Solo un administrador puede hacer esto" };
  }
  const result = await captainRpc(formData, run, notice);
  if (!result.error) revalidatePath("/admin", "layout");
  return result;
}

/** Corta la preparación: la partida en curso empieza ya. */
export async function adminStartGame(
  _prev: MatchFormState,
  formData: FormData,
): Promise<MatchFormState> {
  return adminRpc(
    formData,
    (supabase, matchId) => supabase.rpc("admin_start_game", { p_match_id: matchId }),
    "Partida iniciada",
  );
}

/** Da la partida en curso a un lado, con o sin reporte del capitán. */
export async function adminResolveGame(
  _prev: MatchFormState,
  formData: FormData,
): Promise<MatchFormState> {
  const winner = String(formData.get("winner"));
  if (winner !== "a" && winner !== "b") return { error: "Ganador inválido" };
  const gameId = String(formData.get("gameId") ?? "");
  return adminRpc(
    formData,
    (supabase) => supabase.rpc("resolve_game", { p_game_id: gameId, p_winner: winner }),
    "Partida registrada",
  );
}

/** Descarta el reporte de la partida en curso; el capitán puede volver a reportar. */
export async function adminRejectClaim(
  _prev: MatchFormState,
  formData: FormData,
): Promise<MatchFormState> {
  const gameId = String(formData.get("gameId") ?? "");
  return adminRpc(
    formData,
    (supabase) => supabase.rpc("reject_game_claim", { p_game_id: gameId }),
    "Reporte rechazado",
  );
}

const scoreSchema = z.object({
  scoreA: z.coerce.number().int().min(0).max(5),
  scoreB: z.coerce.number().int().min(0).max(5),
});

/** Fija el marcador de la serie; si alguien llega a las victorias necesarias, la cierra. */
export async function adminSetScore(
  _prev: MatchFormState,
  formData: FormData,
): Promise<MatchFormState> {
  const parsed = scoreSchema.safeParse({
    scoreA: formData.get("scoreA"),
    scoreB: formData.get("scoreB"),
  });
  if (!parsed.success) return { error: "Marcador inválido" };
  // El formato (Bo3 / Bo5) lo valida admin_set_match_score.
  return adminRpc(
    formData,
    (supabase, matchId) =>
      supabase.rpc("admin_set_match_score", {
        p_match_id: matchId,
        p_score_a: parsed.data.scoreA,
        p_score_b: parsed.data.scoreB,
      }),
    "Marcador actualizado",
  );
}

/** El anfitrión no publicó la sala a tiempo: la partida es para el capitán rival. */
export async function claimNoShow(
  _prev: MatchFormState,
  formData: FormData,
): Promise<MatchFormState> {
  return captainRpc(
    formData,
    (supabase, matchId) => supabase.rpc("claim_no_show", { p_match_id: matchId }),
    "Victoria registrada: el rival no publicó la sala a tiempo",
  );
}
