import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { SiteNav } from "@/components/site-nav";
import { getSession } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  // El proxy solo hace un chequeo optimista de sesión; el rol se verifica aquí.
  if (!session) redirect("/login?next=/admin");
  if (session.profile.role !== "admin") redirect("/torneos");

  return (
    <>
      <SiteNav />
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 md:flex-row">
        <aside className="md:w-48 md:shrink-0">
          <nav className="flex gap-2 overflow-x-auto md:flex-col">
            {[
              ["/admin", "Torneos"],
              ["/admin/torneos/nuevo", "Nuevo torneo"],
              ["/admin/validaciones", "Validaciones"],
              ["/admin/usuarios", "Usuarios"],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="shrink-0 rounded-lg px-3 py-2 text-sm text-ink-dim transition hover:bg-surface-2 hover:text-ink"
              >
                {label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </>
  );
}
