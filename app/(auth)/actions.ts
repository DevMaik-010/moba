"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { safeReturnPath } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/server";

export interface AuthFormState {
  error?: string;
}

const credentialsSchema = z.object({
  email: z.string().trim().email("Correo inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

const signUpSchema = credentialsSchema.extend({
  displayName: z
    .string()
    .trim()
    .min(3, "El nombre debe tener al menos 3 caracteres")
    .max(40, "El nombre es demasiado largo"),
});

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

export async function signUp(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { display_name: parsed.data.displayName } },
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
    return { error: "No se pudo crear la cuenta. Si ya tienes una, inicia sesión." };
  }

  // Con confirmación de correo activada en Supabase no hay sesión todavía.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Cuenta creada. Revisa tu correo para confirmarla." };
  }

  revalidatePath("/", "layout");
  redirect("/torneos");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
