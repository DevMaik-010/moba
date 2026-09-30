"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import {
  claimWin,
  disputeClaim,
  enterMatch,
  postRoomId,
  type MatchFormState,
} from "./actions";

type Action = (state: MatchFormState, formData: FormData) => Promise<MatchFormState>;

interface Target {
  matchId: string;
  slug: string;
}

function Submit({ label, variant = "primary" }: { label: string; variant?: "primary" | "ghost" | "danger" }) {
  const { pending } = useFormStatus();
  const styles = {
    primary: "bg-brand text-white hover:brightness-110",
    ghost: "border border-line text-ink hover:border-brand",
    danger: "border border-bad/50 text-bad hover:bg-bad/10",
  }[variant];
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${styles}`}
    >
      {pending ? "Un momento…" : label}
    </button>
  );
}

function Feedback({ state }: { state: MatchFormState }) {
  if (state.error) return <p className="text-sm text-bad">{state.error}</p>;
  if (state.notice) return <p className="text-sm text-win">{state.notice}</p>;
  return null;
}

/** Formulario con los campos ocultos del partido y el feedback de la acción. */
function MatchForm({
  action,
  target,
  className,
  children,
}: {
  action: Action;
  target: Target;
  className?: string;
  children: ReactNode;
}) {
  const [state, formAction] = useActionState<MatchFormState, FormData>(action, {});
  return (
    <form action={formAction} className={className ?? "space-y-3"}>
      <input type="hidden" name="matchId" value={target.matchId} />
      <input type="hidden" name="slug" value={target.slug} />
      {children}
      <Feedback state={state} />
    </form>
  );
}

/**
 * Pide el código de acceso. Con `presetCode` (el capitán que ya conoce el suyo)
 * se reduce a un botón.
 */
export function CodeForm({ presetCode, ...target }: Target & { presetCode?: string }) {
  if (presetCode) {
    return (
      <MatchForm action={enterMatch} target={target} className="space-y-2">
        <input type="hidden" name="code" value={presetCode} />
        <Submit label="Entrar al enfrentamiento" />
      </MatchForm>
    );
  }

  return (
    <MatchForm action={enterMatch} target={target}>
      <div>
        <label className="label" htmlFor="code">
          Código de acceso
        </label>
        <input
          id="code"
          name="code"
          className="field font-mono uppercase tracking-[0.3em]"
          placeholder="A1B2C3D4"
          autoComplete="off"
          maxLength={8}
          required
        />
      </div>
      <Submit label="Entrar" />
    </MatchForm>
  );
}

export function RoomIdForm({ current, ...target }: Target & { current: string | null }) {
  return (
    <MatchForm action={postRoomId} target={target}>
      <div>
        <label className="label" htmlFor="roomId">
          ID de la sala que creaste en MLBB
        </label>
        <input
          id="roomId"
          name="roomId"
          className="field font-mono"
          defaultValue={current ?? ""}
          placeholder="123456789"
          autoComplete="off"
          minLength={3}
          maxLength={32}
          required
        />
      </div>
      <Submit label={current ? "Actualizar ID de sala" : "Publicar ID de sala"} />
    </MatchForm>
  );
}

export function ClaimForm({ myTeam, rivalTeam, ...target }: Target & { myTeam: string; rivalTeam: string }) {
  return (
    <MatchForm action={claimWin} target={target}>
      <p className="text-sm text-ink-dim">
        Solo si ganaste. Pon el marcador de la serie (por ejemplo 2–1 en un Bo3).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="myScore">
            {myTeam}
          </label>
          <input id="myScore" name="myScore" type="number" min={0} max={99} defaultValue={1} className="field w-20" required />
        </div>
        <div>
          <label className="label" htmlFor="rivalScore">
            {rivalTeam}
          </label>
          <input id="rivalScore" name="rivalScore" type="number" min={0} max={99} defaultValue={0} className="field w-20" required />
        </div>
        <Submit label="Mi equipo ganó" />
      </div>
    </MatchForm>
  );
}

export function DisputeForm(target: Target) {
  return (
    <MatchForm action={disputeClaim} target={target}>
      <div>
        <label className="label" htmlFor="note">
          ¿No es correcto? Cuéntale al admin qué pasó
        </label>
        <textarea id="note" name="note" className="field" rows={3} maxLength={500} required />
      </div>
      <Submit label="Disputar resultado" variant="danger" />
    </MatchForm>
  );
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="rounded-md border border-line px-2 py-1 text-xs text-ink-dim transition hover:border-brand hover:text-ink"
    >
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

/**
 * Cada cambio de la sala toca la fila pública del partido; al verlo por
 * Realtime se vuelve a pedir la página, así el rival ve el ID o el reporte al
 * instante sin exponer la sala en el canal.
 */
export function RoomLive({ matchId }: { matchId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`match:${matchId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [matchId, router]);

  return null;
}
