import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { Profile } from "@/lib/db/types";

/**
 * Cliente para Server Components, Server Actions y Route Handlers.
 * En Next 16 `cookies()` es asíncrono.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Los Server Components no pueden escribir cookies; el refresco de
            // sesión lo hace el proxy, así que aquí se puede ignorar.
          }
        },
      },
    },
  );
}

/**
 * Cliente con service role: ignora RLS. Solo para la caché de validación MLBB y
 * scripts de administración. Nunca lo importes desde un componente cliente.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en el entorno");
  }

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export interface SessionInfo {
  userId: string;
  email: string | null;
  profile: Profile;
}

/**
 * Sesión + perfil, o null si no hay usuario. Memoizada por petición: la barra,
 * el layout y la página la piden en el mismo render y solo se consulta una vez.
 * getClaims() verifica el JWT sin ir al servidor de Auth cuando el proyecto usa
 * claves de firma asimétricas (si no, hace la misma llamada que getUser()).
 */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", claims.sub)
    .single();

  if (!profile) return null;

  return { userId: claims.sub, email: claims.email ?? null, profile };
});

export async function isAdmin(): Promise<boolean> {
  const session = await getSession();
  return session?.profile.role === "admin";
}
