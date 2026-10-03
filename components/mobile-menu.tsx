"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { signOut } from "@/app/(auth)/actions";

export interface MenuLink {
  href: string;
  label: string;
  /** Punto de aviso (p. ej. el ID de jugador sin verificar). */
  alert?: "warn" | "bad";
  accent?: boolean;
}

/**
 * Menú de la barra en el celular: un botón que despliega todas las secciones a
 * pantalla completa debajo de la barra, en lugar de amontonarlas en dos líneas.
 */
export function MobileMenu({
  links,
  userName,
}: {
  links: MenuLink[];
  /** null: sin sesión, se ofrecen Entrar y Crear cuenta. */
  userName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Navegar cierra el menú: el cambio de ruta lo dispara el propio enlace.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    // Con el menú abierto la página de atrás no se desplaza.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const hasAlert = links.some((l) => l.alert);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? "Cerrar menú" : "Abrir menú"}
        onClick={() => setOpen((v) => !v)}
        className="relative flex size-11 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface-1 text-ink transition hover:border-brand"
      >
        <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
          {open ? (
            <path d="M6 6l12 12M18 6 6 18" />
          ) : (
            <path d="M4 7h16M4 12h16M4 17h16" />
          )}
        </svg>
        {hasAlert && !open ? (
          <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-warn" aria-hidden />
        ) : null}
      </button>

      {open ? (
        <div
          id="mobile-menu"
          className="absolute inset-x-0 top-full z-40 h-[calc(100dvh-100%)] animate-rise overflow-y-auto border-t border-line bg-surface-0 px-4 pt-4 pb-8"
        >
          <nav aria-label="Secciones" className="flex flex-col gap-1">
            {links.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-12 items-center justify-between rounded-xl border px-4 font-display text-lg tracking-wide transition ${
                    active
                      ? "border-brand/60 bg-brand/15 text-ink shadow-[0_0_18px_-8px_var(--color-brand)]"
                      : "border-transparent text-ink-dim hover:bg-surface-2 hover:text-ink"
                  } ${link.accent ? "text-accent" : ""}`}
                >
                  {link.label}
                  {link.alert ? (
                    <span
                      className={`size-2.5 rounded-full ${link.alert === "warn" ? "bg-warn" : "bg-bad"}`}
                      aria-label="Necesita atención"
                    />
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="mt-6 border-t border-line pt-6">
            {userName ? (
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-ink-dim">{userName}</span>
                <form action={signOut}>
                  <button
                    type="submit"
                    className="min-h-11 cursor-pointer rounded-lg border border-line px-4 text-sm text-ink-dim transition hover:border-bad/60 hover:text-ink"
                  >
                    Salir
                  </button>
                </form>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Link
                  href="/login"
                  className="flex min-h-12 items-center justify-center rounded-lg border border-line font-semibold text-ink"
                >
                  Entrar
                </Link>
                <Link
                  href="/registro"
                  className="flex min-h-12 items-center justify-center rounded-lg bg-brand font-semibold text-white"
                >
                  Crear cuenta
                </Link>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
