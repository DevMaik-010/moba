"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { reportMatch, type AdminFormState } from "@/app/admin/actions";

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

interface Props {
  matchId: string;
  tournamentId: string;
  teamAName: string;
  teamBName: string;
}

export function ReportForm({ matchId, tournamentId, teamAName, teamBName }: Props) {
  const [state, action] = useActionState<AdminFormState, FormData>(reportMatch, {});

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="matchId" value={matchId} />
      <input type="hidden" name="tournamentId" value={tournamentId} />

      <div>
        <label className="label" htmlFor={`a-${matchId}`}>
          {teamAName}
        </label>
        <input
          id={`a-${matchId}`}
          name="scoreA"
          type="number"
          min={0}
          max={99}
          defaultValue={0}
          className="field w-20"
          required
        />
      </div>

      <div>
        <label className="label" htmlFor={`b-${matchId}`}>
          {teamBName}
        </label>
        <input
          id={`b-${matchId}`}
          name="scoreB"
          type="number"
          min={0}
          max={99}
          defaultValue={0}
          className="field w-20"
          required
        />
      </div>

      <Submit />

      {state.error ? (
        <p className="w-full text-xs text-bad">{state.error}</p>
      ) : null}
    </form>
  );
}
