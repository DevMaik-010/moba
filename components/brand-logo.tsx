import { useId } from "react";

/**
 * Emblema de la plataforma: escudo con la M, corona y llaves del cuadro. Es el
 * mismo dibujo que `app/icon.svg` (favicon), simplificado de `public/logo.png`
 * para que se lea a 28 px.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  const id = useId();
  const shield = `${id}-s`;
  const mark = `${id}-m`;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={shield} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b79bff" />
          <stop offset="1" stopColor="#6a3df0" />
        </linearGradient>
        <linearGradient id={mark} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#a68bff" />
        </linearGradient>
      </defs>
      <path
        d="M6 13 16 16 22 12 32 15 42 12 48 16 58 13 55 34C53 47 43 55 32 61 21 55 11 47 9 34Z"
        fill={`url(#${shield})`}
      />
      <path
        d="M13 19 22 17 32 20 42 17 51 19 49 34C47 44 40 50 32 55 24 50 17 44 15 34Z"
        fill="#0b0a24"
        stroke="#22d3ee"
        strokeWidth={1.6}
      />
      <path
        d="M18 34V22L32 42 46 22V34"
        fill="none"
        stroke={`url(#${mark})`}
        strokeWidth={4.6}
        strokeLinecap="square"
      />
      <g fill="none" stroke="#22d3ee" strokeWidth={1.8} strokeLinecap="square">
        <path d="M17 38h4v6h4M17 47h4" />
        <path d="M47 38h-4v6h-4M47 47h-4" />
      </g>
      <path d="M25 18 27 11 32 15 37 11 39 18Z" fill="#fbbf24" />
      <path d="M32 2 35 7 32 11 29 7Z" fill="#22d3ee" />
      <path d="M32 46 35 50 32 54 29 50Z" fill="#22d3ee" />
    </svg>
  );
}

/** Emblema + nombre, para la barra de navegación; sin emblema junto al logo grande. */
export function BrandLogo({ size = 28, mark = true }: { size?: number; mark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      {mark ? <BrandMark size={size} /> : null}
      <span>
        Sistemas<span className="text-brand drop-shadow-[0_0_8px_var(--color-brand)]">MLBB</span>
      </span>
    </span>
  );
}
