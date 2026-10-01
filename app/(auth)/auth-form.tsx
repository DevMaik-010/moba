"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { AuthFormState } from "./actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
    >
      {pending ? "Un momento…" : label}
    </button>
  );
}

interface Props {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  submitLabel: string;
  /** Presente solo en el registro. */
  withDisplayName?: boolean;
  next?: string;
}

export function AuthForm({ action, submitLabel, withDisplayName, next }: Props) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(action, {});
  const values = state.values ?? {};

  return (
    <form action={formAction} className="space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {withDisplayName ? (
        <div>
          <label className="label" htmlFor="displayName">
            Nombre visible
          </label>
          <input
            id="displayName"
            name="displayName"
            className="field"
            placeholder="Cómo te verán en la plataforma"
            defaultValue={values.displayName}
            required
            minLength={3}
            maxLength={40}
          />
        </div>
      ) : null}

      <div>
        <label className="label" htmlFor="email">
          Correo
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          className="field"
          placeholder="tu@correo.com"
          defaultValue={values.email}
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={withDisplayName ? "new-password" : "current-password"}
          className="field"
          placeholder="Mínimo 8 caracteres"
          required
          minLength={8}
        />
      </div>

      {withDisplayName ? (
        <fieldset className="space-y-3 rounded-lg border border-line bg-surface-2/50 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-ink-dim">
            Tu cuenta de MLBB
          </legend>
          <div className="grid grid-cols-[1fr_96px] gap-3">
            <div>
              <label className="label" htmlFor="gameUserId">
                ID de jugador
              </label>
              <input
                id="gameUserId"
                name="gameUserId"
                className="field font-mono"
                inputMode="numeric"
                pattern="[0-9]{5,12}"
                placeholder="123456789"
                defaultValue={values.gameUserId}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="zoneId">
                Servidor
              </label>
              <input
                id="zoneId"
                name="zoneId"
                className="field font-mono"
                inputMode="numeric"
                pattern="[0-9]{3,6}"
                placeholder="1234"
                defaultValue={values.zoneId}
                required
              />
            </div>
          </div>
          <p className="text-xs text-ink-faint">
            Están en tu perfil dentro del juego. Lo verificamos al crear la cuenta; si el
            verificador no responde, un administrador lo revisa. Un ID solo puede estar
            en una cuenta.
          </p>
        </fieldset>
      ) : null}

      {state.error ? (
        <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      ) : null}

      <Submit label={submitLabel} />
    </form>
  );
}
