"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { EVIDENCE_ACCEPT, uploadEvidence } from "@/lib/evidence-upload";
import { useFormDraft } from "@/lib/form-draft";
import { REPORT_REASONS } from "@/lib/reports";
import type { ReportReason } from "@/lib/db/types";
import { createReport, type ReportFormState } from "../actions";

interface Option {
  id: string;
  label: string;
}

interface Props {
  userId: string;
  tournamentId: string;
  teams: Option[];
  matches: Option[];
  defaultMatchId: string | null;
}

export function ReportForm({ userId, tournamentId, teams, matches, defaultMatchId }: Props) {
  const router = useRouter();
  const [state, setState] = useState<ReportFormState>({});
  const [busy, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  // Lo escrito sobrevive a recargar o volver más tarde (la captura no).
  useFormDraft(formRef, `report:${userId}:${tournamentId}:${defaultMatchId ?? ""}`, state);

  function submit(formData: FormData) {
    setState({});
    startTransition(async () => {
      try {
        const file = formData.get("evidence");
        const evidencePath =
          file instanceof File && file.size > 0
            ? await uploadEvidence(userId, file, "reporte")
            : null;

        const result = await createReport({
          tournamentId,
          matchId: String(formData.get("matchId") ?? "") || null,
          teamId: String(formData.get("teamId") ?? "") || null,
          player: String(formData.get("player") ?? ""),
          reason: String(formData.get("reason")) as ReportReason,
          description: String(formData.get("description") ?? ""),
          evidencePath,
        });
        setState(result);
        if (!result.error) router.push("/reportes");
      } catch (e) {
        setState({ error: e instanceof Error ? e.message : "No se pudo enviar el reporte" });
      }
    });
  }

  return (
    <form
      ref={formRef}
      // onSubmit y no action: así un error no vacía lo que ya se escribió.
      onSubmit={(e) => {
        e.preventDefault();
        submit(new FormData(e.currentTarget));
      }}
      className="card space-y-5 p-6"
    >
      <fieldset className="space-y-2">
        <legend className="label">Motivo</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {REPORT_REASONS.map((r, i) => (
            <label
              key={r.value}
              className="flex cursor-pointer gap-3 rounded-lg border border-line p-3 text-sm transition has-checked:border-brand has-checked:bg-brand/5"
            >
              <input
                type="radio"
                name="reason"
                value={r.value}
                defaultChecked={i === 0}
                className="mt-0.5 accent-brand"
                required
              />
              <span>
                <span className="block font-medium">{r.label}</span>
                <span className="block text-xs text-ink-faint">{r.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="teamId">
            Equipo reportado
          </label>
          <select id="teamId" name="teamId" className="field" defaultValue="">
            <option value="">— Ninguno en particular —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="player">
            Jugador (nick o ID, opcional)
          </label>
          <input id="player" name="player" className="field" maxLength={60} autoComplete="off" />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="matchId">
          Enfrentamiento
        </label>
        <select id="matchId" name="matchId" className="field" defaultValue={defaultMatchId ?? ""}>
          <option value="">— Fuera de un enfrentamiento —</option>
          {matches.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="description">
          ¿Qué pasó?
        </label>
        <textarea
          id="description"
          name="description"
          className="field"
          rows={5}
          minLength={10}
          maxLength={2000}
          placeholder="Cuenta en qué partida, a qué hora y qué regla se incumplió."
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="evidence">
          Evidencia (captura, opcional)
        </label>
        <input
          id="evidence"
          name="evidence"
          type="file"
          accept={EVIDENCE_ACCEPT}
          className="block w-full text-sm text-ink-dim file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-2 file:px-3 file:py-1.5 file:text-ink"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "Enviando…" : "Enviar reporte"}
        </button>
        {state.error ? <p className="text-sm text-bad">{state.error}</p> : null}
        {state.notice ? <p className="text-sm text-win">{state.notice}</p> : null}
      </div>
    </form>
  );
}
