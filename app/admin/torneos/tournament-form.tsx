"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { type AdminFormState } from "@/app/admin/actions";
import { BRACKET_SIZES, TEAM_SIZE_BY_MODE } from "@/lib/db/types";
import type { Tournament } from "@/lib/db/types";

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

interface Props {
  action: (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;
  /** Si viene, el formulario edita ese torneo en vez de crear uno. */
  tournament?: Tournament;
  /**
   * Inicio ya formateado para `datetime-local`. Se calcula en el servidor, con
   * la misma zona horaria con la que la acción interpreta la fecha al guardar.
   */
  startsAtInput?: string;
}

export function TournamentForm({ action: serverAction, tournament, startsAtInput }: Props) {
  const [state, action] = useActionState<AdminFormState, FormData>(serverAction, {});
  // Una vez abierto, el cuadro ya está dibujado con ese modo y esos cupos.
  const structureLocked = tournament !== undefined && tournament.status !== "draft";

  return (
    <form action={action} className="card space-y-5 p-6">
      {tournament ? <input type="hidden" name="tournamentId" value={tournament.id} /> : null}

      <div>
        <label className="label" htmlFor="name">
          Nombre
        </label>
        <input
          id="name"
          name="name"
          className="field"
          placeholder="Copa Relámpago 5v5"
          defaultValue={tournament?.name}
          required
          minLength={3}
          maxLength={80}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="mode">
            Modo
          </label>
          <select
            id="mode"
            name="mode"
            className="field"
            defaultValue={tournament?.mode ?? "5v5"}
            disabled={structureLocked}
          >
            {(Object.keys(TEAM_SIZE_BY_MODE) as (keyof typeof TEAM_SIZE_BY_MODE)[]).map(
              (mode) => (
                <option key={mode} value={mode}>
                  {mode} — equipos de {TEAM_SIZE_BY_MODE[mode]}
                </option>
              ),
            )}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="bracketSize">
            Cupos del cuadro
          </label>
          <select
            id="bracketSize"
            name="bracketSize"
            className="field"
            defaultValue={String(tournament?.bracket_size ?? 8)}
            disabled={structureLocked}
          >
            {BRACKET_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} equipos
              </option>
            ))}
          </select>
        </div>
      </div>

      {structureLocked ? (
        <>
          {/* Un select deshabilitado no se envía: se mandan los valores actuales. */}
          <input type="hidden" name="mode" value={tournament.mode} />
          <input type="hidden" name="bracketSize" value={tournament.bracket_size} />
          <p className="-mt-2 text-xs text-ink-faint">
            El modo y los cupos solo se cambian en borrador: el cuadro ya está dibujado.
          </p>
        </>
      ) : null}

      <div>
        <label className="label" htmlFor="startsAt">
          Inicio (opcional)
        </label>
        <input
          id="startsAt"
          name="startsAt"
          type="datetime-local"
          className="field"
          defaultValue={startsAtInput}
        />
      </div>

      <div>
        <label className="label" htmlFor="rules">
          Reglas (opcional)
        </label>
        <textarea
          id="rules"
          name="rules"
          className="field"
          rows={5}
          maxLength={4000}
          defaultValue={tournament?.rules}
        />
      </div>

      <p className="text-xs text-ink-faint">
        Si se inscriben menos equipos que cupos, los que sobren se resuelven como pase
        directo al cerrar las inscripciones.
      </p>

      {state.error ? (
        <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      ) : null}

      {tournament ? (
        <Submit label="Guardar cambios" pendingLabel="Guardando…" />
      ) : (
        <Submit label="Crear torneo" pendingLabel="Creando…" />
      )}
    </form>
  );
}
