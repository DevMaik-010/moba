import { useId } from "react";

/** Emblema de la plataforma: el mismo dibujo que `app/icon.svg` (favicon). */
export function BrandMark({ size = 28 }: { size?: number }) {
  const gradient = useId();
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden
      className="shrink-0"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6b8dff" />
          <stop offset="1" stopColor="#3a4fd6" />
        </linearGradient>
      </defs>
      <path
        d="M32 3 57 13v19c0 14.5-10.6 25-25 29C17.6 57 7 46.5 7 32V13Z"
        fill={`url(#${gradient})`}
        stroke="#c9d6ff"
        strokeOpacity={0.35}
        strokeWidth={2}
      />
      <path
        d="M18 22h9v20h-9M27 32h6"
        fill="none"
        stroke="#fff"
        strokeWidth={3.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m42 24.5 2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1-3.8-3.6 5.2-.8Z"
        fill="#ffd34d"
      />
    </svg>
  );
}

/** Emblema + nombre, para la barra de navegación y las pantallas de acceso. */
export function BrandLogo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <BrandMark size={size} />
      <span>
        Sistemas<span className="text-brand">MLBB</span>
      </span>
    </span>
  );
}
