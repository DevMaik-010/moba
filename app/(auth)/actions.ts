"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  isGameAccountTaken,
  lookupMlbbAccountForSignup,
  RateLimitError,
} from "@/lib/mlbb";
import type { LookupStatus } from "@/lib/mlbb/types";
import { mlbbIdSchema } from "@/lib/mlbb/types";
import { safeReturnPath } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/server";

export interface AuthFormState {
  error?: string;
  /** Lo que escribió el usuario (sin la contraseña), para no perderlo en un error. */
  values?: Record<string, string>;
  /** Cuenta creada: el formulario muestra el resultado en un modal. */
  created?: {
    /** `confirm_email`: Supabase pide confirmar el correo antes de entrar. */
    status: "verified" | "pending" | "confirm_email";
    nickname: string | null;
  };
}

function keepValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of ["email", "gameUserId", "zoneId"]) {
    values[key] = String(formData.get(key) ?? "");
  }
  return values;
}

const credentialsSchema = z.object({
  email: z.string().trim().email("Correo inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

// Sin nombre visible: la cuenta se muestra con su nick de MLBB al verificarse.
const signUpSchema = credentialsSchema.extend(mlbbIdSchema.shape);

/**
 * IP del cliente para el cupo del verificador. Primero `x-real-ip`, que la pone
 * el proxy de delante (Vercel, nginx…): el primer valor de `x-forwarded-for`
 * lo puede inventar el navegador si el proxy solo le añade el suyo al final.
 */
async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "desconocida"
  );
}

export async function signIn(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { error: "Correo o contraseña incorrectos" };
  }

  revalidatePath("/", "layout");
  redirect(safeReturnPath(formData.get("next")) ?? "/torneos");
}

export interface GameIdCheck {
  status: LookupStatus | "taken" | "rate_limited";
  nickname?: string;
}

/**
 * Verificación anticipada mientras el usuario rellena el registro. Usa el mismo
 * camino que signUp (caché → cupo por IP → proveedores), así que al enviar el
 * formulario el veredicto ya está en caché y la creación de la cuenta no espera
 * al proveedor. Es solo informativa: signUp vuelve a comprobarlo todo.
 */
export async function precheckGameId(gameUserId: string, zoneId: string): Promise<GameIdCheck> {
  const parsed = mlbbIdSchema.safeParse({ gameUserId, zoneId });
  if (!parsed.success) return { status: "unavailable" };

  try {
    if (await isGameAccountTaken(parsed.data.gameUserId, parsed.data.zoneId)) {
      return { status: "taken" };
    }
    const result = await lookupMlbbAccountForSignup(
      parsed.data.gameUserId,
      parsed.data.zoneId,
      await clientIp(),
    );
    return { status: result.status, nickname: result.nickname };
  } catch (error) {
    if (error instanceof RateLimitError) return { status: "rate_limited" };
    console.error("[registro] verificación anticipada no disponible:", error);
    return { status: "unavailable" };
  }
}

export async function signUp(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const result = await createAccount(formData);
  return result.created ? result : { ...result, values: keepValues(formData) };
}

async function createAccount(formData: FormData): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    gameUserId: formData.get("gameUserId"),
    zoneId: formData.get("zoneId"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const { gameUserId, zoneId } = parsed.data;

  // Se verifica ANTES de crear la cuenta: un ID que no existe no crea cuenta.
  // Si el verificador no responde, la cuenta se crea y queda en revisión. El
  // estado definitivo lo pone la base de datos leyendo la caché, nunca esto.
  let lookupStatus: LookupStatus = "unavailable";
  try {
    if (await isGameAccountTaken(gameUserId, zoneId)) {
      return { error: "Ese ID de jugador ya está registrado en otra cuenta" };
    }
    lookupStatus = (await lookupMlbbAccountForSignup(gameUserId, zoneId, await clientIp()))
      .status;
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { error: "Demasiados intentos de registro. Espera un rato." };
    }
    console.error("[registro] verificación de ID no disponible:", error);
  }
  if (lookupStatus === "invalid") {
    return { error: "Ese ID de jugador no existe en ese servidor. Revisa los dos números." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        game_user_id: gameUserId,
        zone_id: zoneId,
      },
    },
  });

  if (error) {
    // El mensaje crudo de Supabase ("User already registered") revela qué
    // correos tienen cuenta; solo se distingue lo que el usuario puede corregir.
    if (error.code === "weak_password") {
      return { error: "La contraseña es muy débil: usa una más larga o menos común" };
    }
    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      return { error: "Demasiados intentos. Espera unos minutos." };
    }
    return {
      error:
        "No se pudo crear la cuenta. Si ya tienes una, inicia sesión; si tu ID de jugador ya está en otra cuenta, habla con un administrador.",
    };
  }

  // Con confirmación de correo activada en Supabase no hay sesión todavía.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { created: { status: "confirm_email", nickname: null } };
  }

  // El estado real lo fijó la base de datos al crear el perfil.
  const { data: profile } = await supabase
    .from("profiles")
    .select("mlbb_status, mlbb_nickname")
    .eq("id", user.id)
    .maybeSingle();

  revalidatePath("/", "layout");
  const verified = profile?.mlbb_status === "valid" || profile?.mlbb_status === "manual_ok";
  return {
    created: {
      status: verified ? "verified" : "pending",
      nickname: profile?.mlbb_nickname ?? null,
    },
  };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
