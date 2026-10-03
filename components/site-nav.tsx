import Link from "next/link";

import { signOut } from "@/app/(auth)/actions";
import { BrandLogo } from "@/components/brand-logo";
import { MobileMenu, type MenuLink } from "@/components/mobile-menu";
import { NavLink } from "@/components/nav-link";
import { accountBlocker, accountState } from "@/lib/account";
import { getSession } from "@/lib/supabase/server";

export async function SiteNav() {
  const session = await getSession();
  const isAdmin = session?.profile.role === "admin";
  const state = session ? accountState(session.profile) : null;
  const blocker = state ? accountBlocker(state) : null;

  const menu: MenuLink[] = [
    { href: "/torneos", label: "Torneos" },
    { href: "/ranking", label: "Ranking" },
    ...(session
      ? [
          { href: "/mis-equipos", label: "Mis equipos" },
          { href: "/reportes", label: "Reportes" },
          {
            href: "/perfil",
            label: "Mi perfil",
            alert: blocker ? (state === "pending" ? ("warn" as const) : ("bad" as const)) : undefined,
          },
        ]
      : []),
    ...(isAdmin ? [{ href: "/admin", label: "Admin", accent: true }] : []),
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface-0/80 shadow-[0_1px_0_color-mix(in_oklab,var(--color-brand)_25%,transparent)] backdrop-blur-md">
      <nav className="mx-auto flex max-w-6xl items-center gap-x-6 px-4 py-2.5 md:py-3">
        <Link href="/torneos" className="font-display text-base tracking-wide">
          <BrandLogo />
        </Link>

        <div className="hidden items-center gap-1 text-sm md:flex">
          <NavLink href="/torneos">Torneos</NavLink>
          <NavLink href="/ranking">Ranking</NavLink>
          {session ? (
            <>
              <NavLink href="/mis-equipos">Mis equipos</NavLink>
              <NavLink href="/reportes">Reportes</NavLink>
              <NavLink href="/perfil">
                Mi perfil
                {blocker ? (
                  <span
                    className={`absolute right-0.5 top-0.5 size-2 rounded-full ${
                      state === "pending" ? "bg-warn" : "bg-bad"
                    }`}
                    aria-label="Tu ID de jugador necesita atención"
                  />
                ) : null}
              </NavLink>
            </>
          ) : null}
          {isAdmin ? (
            <NavLink href="/admin" className="text-accent">
              Admin
            </NavLink>
          ) : null}
        </div>

        <div className="ml-auto hidden items-center gap-3 text-sm md:flex">
          {session ? (
            <>
              <span className="hidden text-ink-dim sm:inline">
                {session.profile.display_name}
              </span>
              <form action={signOut}>
                <button
                  type="submit"
                  className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-ink-dim transition hover:border-bad/60 hover:text-ink"
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
                className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-white shadow-[0_0_18px_-6px_var(--color-brand)] transition hover:brightness-110"
              >
                Crear cuenta
              </Link>
            </>
          )}
        </div>
        <div className="ml-auto md:hidden">
          <MobileMenu links={menu} userName={session ? session.profile.display_name : null} />
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
