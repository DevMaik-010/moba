"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/types";

let cached: ReturnType<typeof createBrowserClient<Database>> | null = null;

/** Cliente de navegador. Se reutiliza para no abrir un socket de Realtime por render. */
export function createClient() {
  cached ??= createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return cached;
}
