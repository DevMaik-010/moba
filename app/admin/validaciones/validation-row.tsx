"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { resolveValidation, type AdminFormState } from "@/app/admin/actions";

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
  memberId: string;
  nickname: string | null;
}

export function ValidationRow({ memberId, nickname }: Props) {
  const [state, action] = useActionState<AdminFormState, FormData>(resolveValidation, {});

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="memberId" value={memberId} />

      <div className="min-w-40">
        <label className="label" htmlFor={`nick-${memberId}`}>
          Nick confirmado
        </label>
        <input
          id={`nick-${memberId}`}
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
