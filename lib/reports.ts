import type { ReportReason, ReportStatus } from "@/lib/db/types";

/** Motivos de reporte, en el orden en que se ofrecen. */
export const REPORT_REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: "no_show", label: "No se presentó", hint: "El equipo no entró a la sala a tiempo" },
  { value: "false_result", label: "Resultado falso", hint: "Reportó una victoria que no fue" },
  { value: "cheating", label: "Trampas", hint: "Hacks, bugs a propósito, programas externos" },
  { value: "account_sharing", label: "Cuenta prestada", hint: "Jugó alguien que no está inscrito" },
  { value: "toxicity", label: "Conducta tóxica", hint: "Insultos, acoso, amenazas" },
  { value: "other", label: "Otra regla", hint: "Cualquier otro incumplimiento" },
];

export const REASON_LABEL = Object.fromEntries(
  REPORT_REASONS.map((r) => [r.value, r.label]),
) as Record<ReportReason, string>;

export const REPORT_STATUS_LABEL: Record<
  ReportStatus,
  [string, "neutral" | "brand" | "good" | "warn" | "bad"]
> = {
  open: ["Abierto", "warn"],
  reviewing: ["En revisión", "brand"],
  resolved: ["Sancionado / resuelto", "good"],
  dismissed: ["Descartado", "neutral"],
};
