"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { saveGameAccount, type ProfileFormState } from "./actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
    >
      {pending ? "Verificando…" : label}
    </button>
  );
}

interface Props {
  gameUserId: string | null;
  zoneId: string | null;
  label: string;
}

export function GameAccountForm({ gameUserId, zoneId, label }: Props) {
  const [state, action] = useActionState<ProfileFormState, FormData>(saveGameAccount, {});

  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-[1fr_110px] gap-3">
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
            defaultValue={gameUserId ?? ""}
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
            defaultValue={zoneId ?? ""}
            required
          />
        </div>
      </div>
      {state.error ? <p className="text-sm text-bad">{state.error}</p> : null}
      {state.notice ? <p className="text-sm text-win">{state.notice}</p> : null}
      <Submit label={label} />
    </form>
  );
}
