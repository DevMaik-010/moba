import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { BrandLogo } from "@/components/brand-logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <Link
        href="/torneos"
        className="mb-8 flex flex-col items-center gap-3 font-display text-xl tracking-wide text-ink"
      >
        {/* La versión completa, con brillo: aquí se ve grande. */}
        <Image
          src="/logo.webp"
          alt=""
          width={144}
          height={144}
          priority
          className="rounded-3xl drop-shadow-[0_0_28px_color-mix(in_oklab,var(--color-brand)_55%,transparent)]"
        />
        <BrandLogo mark={false} />
      </Link>
      <div className="card w-full max-w-sm p-6">{children}</div>
    </div>
  );
}
