import type { SVGProps } from "react";

/**
 * Iconos de trazo (24×24, 2px) para todo el sitio. Decorativos por defecto:
 * quien los use junto a un texto no tiene que hacer nada; un icono solo debe
 * llevar `aria-label` y `aria-hidden={false}`.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
      {...props}
    >
      {children}
    </svg>
  );
}

export function TrophyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" />
    </Icon>
  );
}

export function DiceIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function FlameIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 22c4 0 7-2.7 7-6.6 0-3.4-2.3-5.6-3.6-7.4-.4 1.8-1.4 3-2.6 3.6C13 8 11.5 4.6 9 2c0 4-5 6.7-5 12.4C4 19.3 7.6 22 12 22Z" />
    </Icon>
  );
}

export function BoltIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </Icon>
  );
}

export function CrownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7Z" />
    </Icon>
  );
}

export function SwordsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2" />
      <path d="M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2" />
    </Icon>
  );
}

export function FlagIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 22V4M4 4h12l-2 4 2 4H4" />
    </Icon>
  );
}

export function ShieldAlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" />
      <path d="M12 8v4M12 16h.01" />
    </Icon>
  );
}
