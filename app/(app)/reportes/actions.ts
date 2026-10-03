"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { teamCodeCookie } from "@/lib/match-access";
import { createClient, getSession } from "@/lib/supabase/server";

export interface ReportFormState {
  error?: string;
  notice?: string;
}

const reportSchema = z.object({
  tournamentId: z.string().uuid(),
  /** Solo elige qué cookie leer; la base valida el código contra el partido. */
  slug: z.string().min(1).max(80),
  matchId: z.string().uuid(),
  teamId: z.string().uuid().nullable(),
  player: z.string().trim().max(60),
  reason: z.enum(["no_show", "cheating", "toxicity", "account_sharing", "false_result", "other"]),
  description: z
    .string()
    .trim()
    .min(10, "Describe lo que pasó (mínimo 10 caracteres)")
    .max(2000, "La descripción es muy larga"),
  evidencePath: z.string().max(200).nullable(),
});

/**
 * Crea el reporte. Se llama desde el cliente después de subir la evidencia
 * (si la hay) al bucket privado. El código del equipo sale de la cookie de la
 * sala, nunca del formulario: solo quien entró al enfrentamiento lo reporta.
 */
export async function createReport(input: z.input<typeof reportSchema>): Promise<ReportFormState> {
  const session = await getSession();
  if (!session) return { error: "Necesitas iniciar sesión para reportar" };

  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisa los datos del reporte" };
  }
  const data = parsed.data;
  if (!data.teamId && !data.player) {
    return { error: "Indica el equipo o el jugador que reportas" };
  }

  const code = (await cookies()).get(teamCodeCookie(data.slug))?.value ?? null;

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_report", {
    p_tournament_id: data.tournamentId,
    p_match_id: data.matchId,
    p_team_id: data.teamId,
    p_player: data.player || null,
    p_reason: data.reason,
    p_description: data.description,
    p_evidence_path: data.evidencePath,
    p_code: code,
  });
  if (error) return { error: error.message };

  revalidatePath("/reportes");
  revalidatePath("/admin/reportes");
  return { notice: "Reporte enviado. El admin lo revisará." };
}
