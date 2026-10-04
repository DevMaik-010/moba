"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { setMatchSchedule, type AdminFormState } from "@/app/admin/actions";
import { LocalDateTimeInput } from "@/components/ui/local-datetime-input";

function Submit({ label, clear }: { label: string; clear?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={clear ? "clear" : undefined}
      value={clear ? "1" : undefined}
      disabled={pending}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50 ${
        clear
          ? "border border-line text-ink-dim hover:border-bad hover:text-bad"
          : "bg-brand text-white hover:brightness-110"
      }`}
    >
      {pending ? "…" : label}
    </button>
  );
}

interface Props {
  matchId: string;
  tournamentId: string;
  current: string | null;
}

/** Fecha y hora del enfrentamiento, en la zona horaria del admin. */
export function ScheduleForm({ matchId, tournamentId, current }: Props) {
  const [state, action] = useActionState<AdminFormState, FormData>(
    (prev, formData) => {
      // "Quitar fecha" manda el campo vacío.
      if (formData.get("clear")) formData.set("scheduledAt", "");
      return setMatchSchedule(prev, formData);
    },
    {},
  );

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="matchId" value={matchId} />
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <div>
        <label className="label" htmlFor={`schedule-${matchId}`}>
          Fecha y hora
        </label>
        <LocalDateTimeInput
          key={current ?? "none"}
          id={`schedule-${matchId}`}
          name="scheduledAt"
          defaultIso={current}
          className="field"
        />
      </div>
      <Submit label="Guardar fecha" />
      {current ? <Submit label="Quitar fecha" clear /> : null}
      {state.error ? <p className="w-full text-xs text-bad">{state.error}</p> : null}
      {state.notice ? <p className="w-full text-xs text-win">{state.notice}</p> : null}
    </form>
  );
}
