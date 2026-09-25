import type { ReactNode } from "react";

import { SiteNav } from "@/components/site-nav";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t border-line px-4 py-6 text-center text-xs text-ink-faint">
        Proyecto comunitario. No afiliado a Moonton ni a Mobile Legends: Bang Bang.
      </footer>
    </>
  );
}
