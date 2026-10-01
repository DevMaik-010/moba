"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  resolveProfileValidation,
  resolveValidation,
  type AdminFormState,
} from "@/app/admin/actions";

function Buttons() {
  const { pending } = useFormStatus();
  return (
    <div className="flex gap-2">
      <button
        type="submit"
        name="status"
        value="manual_ok"
        disabled={pending}
        className="rounded-lg border border-win/50 px-3 py-1.5 text-sm font-semibold text-win transition hover:bg-win/10 disabled:opacity-40"
      >
        Aprobar
      </button>
      <button
        type="submit"
        name="status"
        value="manual_rejected"
        disabled={pending}
        className="rounded-lg border border-bad/50 px-3 py-1.5 text-sm font-semibold text-bad transition hover:bg-bad/10 disabled:opacity-40"
      >
        Rechazar
      </button>
    </div>
  );
}

interface Props {
  /** Fila de un roster (`member`) o cuenta de usuario (`profile`). */
  kind?: "member" | "profile";
  id: string;
  nickname: string | null;
}

export function ValidationRow({ kind = "member", id, nickname }: Props) {
  const [state, action] = useActionState<AdminFormState, FormData>(
    kind === "profile" ? resolveProfileValidation : resolveValidation,
    {},
  );

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name={kind === "profile" ? "profileId" : "memberId"} value={id} />

      <p className="w-full text-xs text-ink-faint">
        Si el sistema sigue sin responder, resuélvelo a mano:
      </p>

      <div className="min-w-40">
        <label className="label" htmlFor={`nick-${id}`}>
          Nick confirmado
        </label>
        <input
          id={`nick-${id}`}
          name="nickname"
          className="field"
          defaultValue={nickname ?? ""}
          placeholder="Como aparece en el juego"
        />
      </div>

      <Buttons />

      {state.error ? <p className="w-full text-xs text-bad">{state.error}</p> : null}
    </form>
  );
}
