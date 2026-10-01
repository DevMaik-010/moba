import Link from "next/link";

import { signOut } from "@/app/(auth)/actions";
import { BrandLogo } from "@/components/brand-logo";
import { accountBlocker, accountState } from "@/lib/account";
import { getSession } from "@/lib/supabase/server";

export async function SiteNav() {
  const session = await getSession();
  const isAdmin = session?.profile.role === "admin";
  const state = session ? accountState(session.profile) : null;
  const blocker = state ? accountBlocker(state) : null;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface-0/85 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/torneos" className="text-base font-bold tracking-tight">
          <BrandLogo />
        </Link>

        <div className="flex items-center gap-4 text-sm text-ink-dim">
          <Link href="/torneos" className="hover:text-ink">
            Torneos
          </Link>
          {session ? (
            <>
              <Link href="/mis-equipos" className="hover:text-ink">
                Mis equipos
              </Link>
              <Link href="/perfil" className="relative hover:text-ink">
                Mi perfil
                {blocker ? (
                  <span
                    className={`absolute -right-2 -top-0.5 size-1.5 rounded-full ${
                      state === "pending" ? "bg-warn" : "bg-bad"
                    }`}
                    aria-label="Tu ID de jugador necesita atención"
                  />
                ) : null}
              </Link>
            </>
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
      {blocker ? (
        <div
          className={`border-t px-4 py-2 text-center text-xs ${
            state === "pending"
              ? "border-warn/30 bg-warn/10 text-warn"
              : "border-bad/30 bg-bad/10 text-bad"
          }`}
        >
          {blocker}{" "}
          <Link href="/perfil" className="font-semibold underline underline-offset-2">
            Ir a Mi perfil
          </Link>
        </div>
      ) : null}
    </header>
  );
}
