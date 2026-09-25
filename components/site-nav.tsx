import Link from "next/link";

import { signOut } from "@/app/(auth)/actions";
import { getSession } from "@/lib/supabase/server";

export async function SiteNav() {
  const session = await getSession();
  const isAdmin = session?.profile.role === "admin";

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface-0/85 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/torneos" className="text-base font-bold tracking-tight">
          Sistemas<span className="text-brand">MLBB</span>
        </Link>

        <div className="flex items-center gap-4 text-sm text-ink-dim">
          <Link href="/torneos" className="hover:text-ink">
            Torneos
          </Link>
          {session ? (
            <Link href="/mis-equipos" className="hover:text-ink">
              Mis equipos
            </Link>
          ) : null}
          {isAdmin ? (
            <Link href="/admin" className="font-medium text-brand hover:brightness-125">
              Admin
            </Link>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-3 text-sm">
          {session ? (
            <>
              <span className="hidden text-ink-dim sm:inline">
                {session.profile.display_name}
              </span>
              <form action={signOut}>
                <button
                  type="submit"
                  className="rounded-lg border border-line px-3 py-1.5 text-ink-dim transition hover:text-ink"
                >
                  Salir
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="text-ink-dim hover:text-ink">
                Entrar
              </Link>
              <Link
                href="/registro"
                className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-white transition hover:brightness-110"
              >
                Crear cuenta
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
