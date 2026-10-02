"use client";

import { useActionState, useEffect, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import { EVIDENCE_ACCEPT, uploadEvidence } from "@/lib/evidence-upload";
import { createClient } from "@/lib/supabase/client";
import {
  claimGame,
  confirmClaim,
  disputeClaim,
  enterMatch,
  markReady,
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

/** Pide el código de inscripción del equipo para entrar a la sala. */
export function CodeForm(target: Target) {
  return (
    <MatchForm action={enterMatch} target={target}>
      <div>
        <label className="label" htmlFor="code">
          Código de inscripción
        </label>
        <input
          id="code"
          name="code"
          className="field font-mono uppercase tracking-[0.3em]"
          placeholder="ABCD2345"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={12}
          required
        />
      </div>
      <Submit label="Entrar al enfrentamiento" />
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

/** El capitán marca a su equipo listo para empezar antes de los 5 minutos. */
export function ReadyForm(target: Target) {
  return (
    <MatchForm action={markReady} target={target}>
      <Submit label="Mi equipo está listo" />
    </MatchForm>
  );
}

/** Victoria de la partida en curso: primero sube la captura, después reporta. */
export function ClaimGameForm({
  userId,
  gameNo,
  ...target
}: Target & { userId: string; gameNo: number }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [state, setState] = useState<MatchFormState>({});
  const [busy, startTransition] = useTransition();

  function pick(next: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(next ? URL.createObjectURL(next) : null);
  }

  function submit() {
    if (!file) {
      setState({ error: "Adjunta la captura de la pantalla de victoria" });
      return;
    }
    setState({});
    startTransition(async () => {
      try {
        const screenshotPath = await uploadEvidence(userId, file, `${target.matchId}-g${gameNo}`);
        const result = await claimGame({ ...target, screenshotPath });
        setState(result);
        if (!result.error) router.refresh();
      } catch (e) {
        setState({ error: e instanceof Error ? e.message : "No se pudo subir la captura" });
      }
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-dim">
        Solo si tu equipo ganó la partida {gameNo}. Sube la captura de la pantalla final: el
        capitán rival puede confirmarla al instante y, si no, el admin la verifica.
      </p>
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line px-4 py-5 text-center text-sm text-ink-dim transition hover:border-brand">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:)
          <img src={preview} alt="Vista previa de la captura" className="max-h-48 rounded-md" />
        ) : (
          <span>Toca para elegir la captura (PNG, JPG o WebP)</span>
        )}
        {file ? <span className="text-xs text-ink-faint">{file.name} · cambiar</span> : null}
        <input
          type="file"
          accept={EVIDENCE_ACCEPT}
          className="sr-only"
          disabled={busy}
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
      </label>
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
      >
        {busy ? "Subiendo…" : `Ganamos la partida ${gameNo}`}
      </button>
      <Feedback state={state} />
    </div>
  );
}

/** El capitán rival acepta el resultado reportado. */
export function ConfirmForm({ claimTeam, ...target }: Target & { claimTeam: string }) {
  return (
    <MatchForm action={confirmClaim} target={target}>
      <Submit label={`Confirmar: ganó ${claimTeam}`} />
    </MatchForm>
  );
}

/**
 * Cuenta regresiva de la preparación. Corrige el reloj del navegador con la
 * hora del servidor y, al llegar a cero, vuelve a pedir la página para que
 * aparezca el formulario de resultado.
 */
export function PrepCountdown({ startsAt, serverNow }: { startsAt: string; serverNow: string }) {
  const router = useRouter();
  // null hasta montar: el servidor y el navegador no comparten reloj.
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const offset = Date.parse(serverNow) - Date.now();
    const target = Date.parse(startsAt);
    // tick corre siempre después de crear el intervalo (el primero va por setTimeout).
    const tick = () => {
      const ms = Math.max(0, target - (Date.now() + offset));
      setLeft(ms);
      if (ms === 0) {
        clearInterval(id);
        router.refresh();
      }
    };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [startsAt, serverNow, router]);

  if (left === null) {
    return <p className="font-mono text-4xl font-semibold tabular-nums text-ink-faint">--:--</p>;
  }

  const total = Math.ceil(left / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  const pct = Math.min(100, (left / (5 * 60 * 1000)) * 100);

  return (
    <div className="space-y-2">
      <p className="font-mono text-4xl font-semibold tabular-nums" aria-live="polite">
        {mm}:{ss}
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        <div className="h-full bg-warn transition-[width] duration-1000" style={{ width: `${pct}%` }} />
      </div>
    </div>
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
