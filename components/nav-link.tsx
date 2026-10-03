"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Enlace de la barra que se marca cuando estás en su sección. */
export function NavLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative rounded-md px-2.5 py-1.5 font-semibold transition ${
        active ? "bg-brand/15 text-ink" : "text-ink-dim hover:bg-surface-2 hover:text-ink"
      } ${className}`}
    >
      {children}
      {active ? (
        <span
          className="absolute inset-x-2 -bottom-[13px] h-0.5 rounded-full bg-brand shadow-[0_0_10px_var(--color-brand)]"
          aria-hidden
        />
      ) : null}
    </Link>
  );
}
