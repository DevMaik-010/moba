import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <Link
        href="/torneos"
        className="mb-8 text-lg font-bold tracking-tight text-ink hover:text-brand"
      >
        Sistemas<span className="text-brand">MLBB</span>
      </Link>
      <div className="card w-full max-w-sm p-6">{children}</div>
    </div>
  );
}
