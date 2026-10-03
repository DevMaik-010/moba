"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { diagnoseMlbbAccount, lookupMlbbAccountAsAdmin, type MlbbDiagnosis } from "@/lib/mlbb";
import { mlbbIdSchema } from "@/lib/mlbb/types";
import { createClient, getSession } from "@/lib/supabase/server";
import { BRACKET_SIZES, TEAM_SIZE_BY_MODE } from "@/lib/db/types";
import type { ValidationStatus } from "@/lib/db/types";

export interface AdminFormState {
  error?: string;
  notice?: string;
}

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.profile.role !== "admin") {
    throw new Error("Solo un administrador puede hacer esto");
  }
  return session;
}

/** "Copa Verano 2026" → "copa-verano-2026" */
function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

const tournamentSchema = z.object({
  name: z.string().trim().min(3, "El nombre es muy corto").max(80),
  mode: z.enum(["1v1", "3v3", "5v5"]),
  bracketSize: z.coerce
    .number()
    .refine((n) => (BRACKET_SIZES as readonly number[]).includes(n), "Cupos inválidos"),
  // Llega en ISO desde el navegador, que ya aplicó la zona horaria del organizador.
  startsAt: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), "Fecha de inicio inválida"),
  rules: z.string().trim().max(4000).default(""),
});

function parseTournament(formData: FormData) {
  return tournamentSchema.safeParse({
    name: formData.get("name"),
    mode: formData.get("mode"),
    bracketSize: formData.get("bracketSize"),
    startsAt: formData.get("startsAt") ?? "",
    rules: formData.get("rules") ?? "",
  });
}

export async function createTournament(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  let session;
  try {
    session = await requireAdmin();
  } catch (error) {
    return { error: (error as Error).message };
  }

  const parsed = parseTournament(formData);

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisa los datos del torneo" };
  }

  const { name, mode, bracketSize, startsAt, rules } = parsed.data;
  const supabase = await createClient();

  // El slug debe ser único; si choca se le añade un sufijo corto.
  let slug = slugify(name);
  const { data: clash } = await supabase
    .from("tournaments")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (clash) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  const { data, error } = await supabase
    .from("tournaments")
    .insert({
      name,
      slug,
      mode,
      team_size: TEAM_SIZE_BY_MODE[mode],
      bracket_size: bracketSize,
      rules,
      starts_at: startsAt ? new Date(startsAt).toISOString() : null,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "No se pudo crear el torneo" };
  }

  revalidatePath("/admin");
  revalidatePath("/torneos");
  redirect(`/admin/torneos/${data.id}`);
}

export async function updateTournament(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    await requireAdmin();
  } catch (error) {
    return { error: (error as Error).message };
  }

  const tournamentId = String(formData.get("tournamentId"));
  const parsed = parseTournament(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisa los datos del torneo" };
  }

  const { name, mode, bracketSize, startsAt, rules } = parsed.data;
  const supabase = await createClient();

  // El slug no se toca: los enlaces ya compartidos siguen funcionando.
  const { error } = await supabase.rpc("update_tournament", {
    p_tournament_id: tournamentId,
    p_name: name,
    p_rules: rules,
    p_starts_at: startsAt ? new Date(startsAt).toISOString() : null,
    p_mode: mode,
    p_bracket_size: bracketSize,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath(`/admin/torneos/${tournamentId}`);
  revalidatePath("/torneos");
  redirect(`/admin/torneos/${tournamentId}`);
}

export async function deleteTournament(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    await requireAdmin();
  } catch (error) {
    return { error: (error as Error).message };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_tournament", {
    p_tournament_id: String(formData.get("tournamentId")),
  });
  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath("/torneos");
  redirect("/admin");
}

export async function removeTeam(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    await requireAdmin();
  } catch (error) {
    return { error: (error as Error).message };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_team", {
    p_team_id: String(formData.get("teamId")),
  });
  if (error) return { error: error.message };

  revalidatePath(`/admin/torneos/${String(formData.get("tournamentId"))}`);
  revalidatePath("/torneos");
  return { notice: "Equipo quitado" };
}

async function setArchived(formData: FormData, archived: boolean): Promise<AdminFormState> {
  try {
    await requireAdmin();
  } catch (error) {
    return { error: (error as Error).message };
  }

  const tournamentId = String(formData.get("tournamentId"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_tournament_archived", {
    p_tournament_id: tournamentId,
    p_archived: archived,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin");
  revalidatePath(`/admin/torneos/${tournamentId}`);
  revalidatePath("/torneos");
  return { notice: archived ? "Torneo archivado" : "Torneo restaurado" };
}

export async function archiveTournament(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  return setArchived(formData, true);
}

export async function unarchiveTournament(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  return setArchived(formData, false);
}

type TournamentRpc =
  | "open_tournament"
  | "lock_tournament"
  | "start_tournament"
  | "cancel_tournament"
  | "shuffle_bracket";

async function callTournamentRpc(
  fn: TournamentRpc,
  tournamentId: string,
): Promise<AdminFormState> {
  try {
    await requireAdmin();
  } catch (error) {
    return { error: (error as Error).message };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, { p_tournament_id: tournamentId });
  if (error) return { error: error.message };

  revalidatePath(`/admin/torneos/${tournamentId}`);
  revalidatePath("/torneos");
  return { notice: "Listo" };
}

export async function openTournament(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  return callTournamentRpc("open_tournament", String(formData.get("tournamentId")));
}

export async function lockTournament(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  return callTournamentRpc("lock_tournament", String(formData.get("tournamentId")));
}

export async function startTournament(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  return callTournamentRpc("start_tournament", String(formData.get("tournamentId")));
}

/** Vuelve a sortear los cruces entre los equipos inscritos (antes de iniciar). */
export async function shuffleBracket(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const tournamentId = String(formData.get("tournamentId"));
  const result = await callTournamentRpc("shuffle_bracket", tournamentId);
  return result.error ? result : { notice: "Cuadro resorteado" };
}

export async function cancelTournament(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  return callTournamentRpc("cancel_tournament", String(formData.get("tournamentId")));
}

const reportSchema = z.object({
  matchId: z.string().uuid(),
  scoreA: z.coerce.number().int().min(0).max(99),
  scoreB: z.coerce.number().int().min(0).max(99),
});

export async function reportMatch(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    await requireAdmin();
  } catch (error) {
    return { error: (error as Error).message };
  }

  const parsed = reportSchema.safeParse({
    matchId: formData.get("matchId"),
    scoreA: formData.get("scoreA"),
    scoreB: formData.get("scoreB"),
  });
  if (!parsed.success) {
    return { error: "Marcador inválido" };
  }
  if (parsed.data.scoreA === parsed.data.scoreB) {
    return { error: "No se admiten empates" };
  }
  // El formato (Bo3 / Bo5) lo valida report_match.

  const supabase = await createClient();
  const { error } = await supabase.rpc("report_match", {
    p_match_id: parsed.data.matchId,
    p_score_a: parsed.data.scoreA,
    p_score_b: parsed.data.scoreB,
  });
  if (error) return { error: error.message };

  const tournamentId = String(formData.get("tournamentId"));
  revalidatePath(`/admin/torneos/${tournamentId}/partidos`);
  revalidatePath("/torneos");
  return { notice: "Resultado registrado" };
}

function revalidateResults(tournamentId: string) {
  revalidatePath(`/admin/torneos/${tournamentId}/partidos`);
  revalidatePath(`/admin/torneos/${tournamentId}`);
  revalidatePath("/admin");
  revalidatePath("/torneos", "layout");
}

/**
 * Da la partida a un lado: confirma el reporte del capitán, lo invierte o la
 * adjudica sin reporte (p. ej. si un equipo no se presentó).
 */
export async function resolveGame(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    await requireAdmin();
  } catch (error) {
    return { error: (error as Error).message };
  }

  const winner = String(formData.get("winner"));
  if (winner !== "a" && winner !== "b") return { error: "Ganador inválido" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_game", {
    p_game_id: String(formData.get("gameId")),
    p_winner: winner,
  });
  if (error) return { error: error.message };

  revalidateResults(String(formData.get("tournamentId")));
  return { notice: "Partida registrada" };
}

/** Descarta el reporte de la partida; el capitán puede volver a reportar. */
export async function rejectGameClaim(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    await requireAdmin();
  } catch (error) {
    return { error: (error as Error).message };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_game_claim", {
    p_game_id: String(formData.get("gameId")),
  });
  if (error) return { error: error.message };

  revalidateResults(String(formData.get("tournamentId")));
  return { notice: "Reporte rechazado" };
}

const REPORT_STATUSES = ["reviewing", "resolved", "dismissed"] as const;

export async function resolveReport(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    await requireAdmin();
  } catch (error) {
    return { error: (error as Error).message };
  }

  const status = String(formData.get("status"));
  if (!(REPORT_STATUSES as readonly string[]).includes(status)) {
    return { error: "Estado inválido" };
  }
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);

  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_report", {
    p_report_id: String(formData.get("reportId")),
    p_status: status as (typeof REPORT_STATUSES)[number],
    p_note: note || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/reportes");
  revalidatePath("/admin");
  return { notice: "Reporte actualizado" };
}

export async function setRole(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const session = await getSession().catch(() => null);
  if (!session || session.profile.role !== "admin") {
    return { error: "Solo un administrador puede cambiar roles" };
  }

  const profileId = String(formData.get("profileId"));
  const role = String(formData.get("role"));
  if (role !== "admin" && role !== "user") return { error: "Rol inválido" };
  if (profileId === session.userId) {
    return { error: "No puedes cambiar tu propio rol" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_role", {
    p_profile_id: profileId,
    p_role: role,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/usuarios");
  return { notice: "Rol actualizado" };
}

export async function resolveValidation(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    await requireAdmin();
  } catch (error) {
    return { error: (error as Error).message };
  }

  const memberId = String(formData.get("memberId"));
  const status = String(formData.get("status")) as ValidationStatus;
  const nickname = String(formData.get("nickname") ?? "").trim();

  if (status !== "manual_ok" && status !== "manual_rejected") {
    return { error: "Resolución inválida" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_member_validation", {
    p_member_id: memberId,
    p_status: status,
    p_nickname: nickname || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/validaciones");
  return { notice: "Validación resuelta" };
}

export async function resolveProfileValidation(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    await requireAdmin();
  } catch (error) {
    return { error: (error as Error).message };
  }

  const status = String(formData.get("status")) as ValidationStatus;
  const nickname = String(formData.get("nickname") ?? "").trim();
  if (status !== "manual_ok" && status !== "manual_rejected") {
    return { error: "Resolución inválida" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_profile_validation", {
    p_profile_id: String(formData.get("profileId")),
    p_status: status,
    p_nickname: nickname || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/validaciones");
  revalidatePath("/admin/usuarios");
  return { notice: "Cuenta resuelta" };
}

/**
 * Antes de resolver a mano: vuelve a consultar el ID al verificador y, si
 * ahora responde, aplica su veredicto a todas las filas pendientes con ese ID.
 */
export async function revalidateGameId(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    await requireAdmin();
  } catch (error) {
    return { error: (error as Error).message };
  }

  const parsed = mlbbIdSchema.safeParse({
    gameUserId: formData.get("gameUserId"),
    zoneId: formData.get("zoneId"),
  });
  if (!parsed.success) return { error: "ID inválido" };
  const { gameUserId, zoneId } = parsed.data;

  let nickname: string | undefined;
  try {
    nickname = (await lookupMlbbAccountAsAdmin(gameUserId, zoneId)).nickname;
  } catch (error) {
    console.error("[admin] revalidación falló:", error);
  }

  const supabase = await createClient();
  const { data: status, error } = await supabase.rpc("revalidate_game_account", {
    p_game_user_id: gameUserId,
    p_zone_id: zoneId,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/validaciones");
  revalidatePath("/admin");
  revalidatePath("/admin/usuarios");

  if (status === "valid") return { notice: `Verificado por el sistema${nickname ? `: ${nickname}` : ""}` };
  if (status === "invalid") return { notice: "El sistema dice que ese ID no existe" };
  return { error: "El verificador sigue sin responder. Resuélvelo a mano." };
}

export interface DiagnoseState {
  error?: string;
  input?: { gameUserId: string; zoneId: string };
  result?: MlbbDiagnosis;
}

/** Buscador de pruebas: consulta todos los proveedores sin caché ni cupo. */
export async function diagnoseGameId(
  _prev: DiagnoseState,
  formData: FormData,
): Promise<DiagnoseState> {
  await requireAdmin();

  const parsed = mlbbIdSchema.safeParse({
    gameUserId: formData.get("gameUserId"),
    zoneId: formData.get("zoneId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const { gameUserId, zoneId } = parsed.data;
  return {
    input: { gameUserId, zoneId },
    result: await diagnoseMlbbAccount(gameUserId, zoneId),
  };
}
