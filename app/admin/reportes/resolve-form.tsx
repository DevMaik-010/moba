"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { resolveReport, type AdminFormState } from "@/app/admin/actions";
import type { ReportStatus } from "@/lib/db/types";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
    >
      {pending ? "…" : "Guardar"}
    </button>
  );
}

export function ResolveReportForm({
  reportId,
  status,
  note,
}: {
  reportId: string;
  status: ReportStatus;
  note: string | null;
}) {
  const [state, action] = useActionState<AdminFormState, FormData>(resolveReport, {});

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="reportId" value={reportId} />
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor={`status-${reportId}`}>
            Estado
          </label>
          <select
            id={`status-${reportId}`}
            name="status"
            defaultValue={status === "open" ? "reviewing" : status}
            className="field"
          >
            <option value="reviewing">En revisión</option>
            <option value="resolved">Sancionado / resuelto</option>
            <option value="dismissed">Descartado</option>
          </select>
        </div>
        <div className="min-w-48 flex-1">
          <label className="label" htmlFor={`note-${reportId}`}>
            Respuesta (la ve quien reportó)
          </label>
          <input
            id={`note-${reportId}`}
            name="note"
            defaultValue={note ?? ""}
            maxLength={1000}
            className="field"
            placeholder="Ej.: se descalificó al equipo por no presentarse"
          />
        </div>
        <Submit />
      </div>
      {state.error ? <p className="text-xs text-bad">{state.error}</p> : null}
      {state.notice ? <p className="text-xs text-win">{state.notice}</p> : null}
    </form>
  );
}
