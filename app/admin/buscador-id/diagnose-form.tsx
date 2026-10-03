"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { diagnoseGameId, type DiagnoseState } from "@/app/admin/actions";

const STATUS_TONE = {
  valid: "border-win/40 text-win",
  invalid: "border-bad/40 text-bad",
  unavailable: "border-warn/40 text-warn",
} as const;

const STATUS_LABEL = {
  valid: "Válido",
  invalid: "No existe",
  unavailable: "Sin respuesta",
} as const;

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
    >
      {pending ? "Consultando…" : "Buscar"}
    </button>
  );
}

function Raw({ value }: { value: unknown }) {
  return (
    <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-xs text-ink-dim">
      {JSON.stringify(value, null, 2) ?? "—"}
    </pre>
  );
}

export function DiagnoseForm() {
  const [state, formAction] = useActionState<DiagnoseState, FormData>(diagnoseGameId, {});
  const { result, input } = state;

  return (
    <div className="space-y-4">
      <form action={formAction} className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-40 flex-1">
          <label className="label" htmlFor="gameUserId">
            ID de jugador
          </label>
          <input
            id="gameUserId"
            name="gameUserId"
            className="field font-mono"
            inputMode="numeric"
            placeholder="123456789"
            defaultValue={input?.gameUserId}
            required
          />
        </div>
        <div className="w-28">
          <label className="label" htmlFor="zoneId">
            Servidor
          </label>
          <input
            id="zoneId"
            name="zoneId"
            className="field font-mono"
            inputMode="numeric"
            placeholder="1234"
            defaultValue={input?.zoneId}
            required
          />
        </div>
        <Submit />
      </form>

      {state.error ? (
        <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      ) : null}

      {result ? (
        <>
          <p className="text-xs text-ink-faint">
            Servidor que respondió: región {result.env.region ?? "local"} · clave de gamecasela{" "}
            {result.env.gamecaselaKey ? (
              <span className="text-win">configurada</span>
            ) : (
              <span className="font-semibold text-bad">FALTA (GAMECASELA_FIREBASE_API_KEY)</span>
            )}
          </p>

          {result.takenBy ? (
            <p className="card border-warn/40 bg-warn/5 p-3 text-sm">
              <span className="font-semibold text-warn">Ya registrado</span>
              <span className="ml-2 text-ink-dim">
                en la cuenta de {result.takenBy.display_name || result.takenBy.id} (estado:{" "}
                {result.takenBy.mlbb_status ?? "—"})
              </span>
            </p>
          ) : null}

          {result.providers.map((p) => (
            <section key={p.provider} className={`card border p-4 ${STATUS_TONE[p.status]}`}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold">{p.provider}</span>
                <span className="text-sm">{STATUS_LABEL[p.status]}</span>
                {p.nickname ? (
                  <span className="text-sm text-ink">
                    Nick: <span className="font-semibold">{p.nickname}</span>
                  </span>
                ) : null}
                <span className="ml-auto font-mono text-xs text-ink-faint">{p.ms} ms</span>
              </div>
              <Raw value={p.raw} />
            </section>
          ))}

          <section className="card p-4">
            <span className="font-semibold">Caché</span>
            <span className="ml-2 text-xs text-ink-faint">
              {result.cache ? "lo que usa el registro antes de ir a los proveedores" : "sin entrada"}
            </span>
            {result.cache ? <Raw value={result.cache} /> : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
