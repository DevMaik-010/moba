import type { ReactNode } from "react";

import type { MatchStatus, TournamentStatus, ValidationStatus } from "@/lib/db/types";

type Tone = "neutral" | "brand" | "good" | "warn" | "bad";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-line bg-surface-2 text-ink-dim",
  brand: "border-brand/40 bg-brand/10 text-brand",
  good: "border-win/40 bg-win/10 text-win",
  warn: "border-warn/40 bg-warn/10 text-warn",
  bad: "border-bad/40 bg-bad/10 text-bad",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

const TOURNAMENT_LABEL: Record<TournamentStatus, [string, Tone]> = {
  draft: ["Borrador", "neutral"],
  open: ["Inscripciones abiertas", "good"],
  locked: ["Cerrado", "warn"],
  running: ["En juego", "brand"],
  finished: ["Finalizado", "neutral"],
  cancelled: ["Cancelado", "bad"],
};

export function TournamentBadge({ status }: { status: TournamentStatus }) {
  const [label, tone] = TOURNAMENT_LABEL[status];
  return (
    <Badge tone={tone}>
      {status === "running" ? <LiveDot /> : null}
      {label}
    </Badge>
  );
}

const VALIDATION_LABEL: Record<ValidationStatus, [string, Tone]> = {
  valid: ["Verificado", "good"],
  manual_ok: ["Verificado por admin", "good"],
  pending: ["Pendiente de revisión", "warn"],
  invalid: ["No existe", "bad"],
  manual_rejected: ["Rechazado", "bad"],
};

export function ValidationBadge({ status }: { status: ValidationStatus }) {
  const [label, tone] = VALIDATION_LABEL[status];
  return <Badge tone={tone}>{label}</Badge>;
}

const MATCH_LABEL: Record<MatchStatus, [string, Tone]> = {
  pending: ["Esperando", "neutral"],
  ready: ["Listo", "brand"],
  live: ["En vivo", "warn"],
  done: ["Jugado", "good"],
  bye: ["Bye", "neutral"],
};

/** Punto que late: marca lo que está pasando ahora mismo. */
function LiveDot() {
  return (
    <span className="relative mr-1.5 flex size-1.5" aria-hidden>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-75" />
      <span className="relative inline-flex size-1.5 rounded-full bg-current" />
    </span>
  );
}

export function MatchBadge({ status }: { status: MatchStatus }) {
  const [label, tone] = MATCH_LABEL[status];
  return (
    <Badge tone={tone}>
      {status === "live" ? <LiveDot /> : null}
      {label}
    </Badge>
  );
}
