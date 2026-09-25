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
            placeholder="Tu nick de organizador"
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

      {state.error ? (
        <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      ) : null}

      <Submit label={submitLabel} />
    </form>
  );
}
