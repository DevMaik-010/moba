import { teamLogoUrl } from "@/lib/team-logo";

interface Props {
  name: string | null | undefined;
  tag?: string | null;
  path: string | null | undefined;
  /** Lado en píxeles. */
  size?: number;
  className?: string;
}

/** Logo del equipo, o sus iniciales sobre un fondo neutro si no subió uno. */
export function TeamLogo({ name, tag, path, size = 24, className = "" }: Props) {
  const url = teamLogoUrl(path);
  const box = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-surface-2 ${className}`;

  if (url) {
    return (
      // Logos chicos de nuestro propio bucket: no vale la pena el optimizador.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name ? `Logo de ${name}` : ""}
        width={size}
        height={size}
        loading="lazy"
        className={`${box} object-cover`}
        style={{ width: size, height: size }}
      />
    );
  }

  const initials = (tag || name || "?")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .slice(0, 2)
    .toUpperCase();

  return (
    <span
      aria-hidden
      className={`${box} font-mono font-semibold text-ink-faint`}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38) }}
    >
      {name ? initials || "?" : ""}
    </span>
  );
}
