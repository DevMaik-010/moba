"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import { ScheduleForm } from "@/components/admin/schedule-form";
import { DiceIcon, FlagIcon, FlameIcon, TrophyIcon } from "@/components/ui/icons";
import { TeamLogo } from "@/components/ui/team-logo";
import type { MatchSide } from "@/lib/db/types";
import { EVIDENCE_ACCEPT, uploadEvidence } from "@/lib/evidence-upload";
import { useFormDraft } from "@/lib/form-draft";
import { createClient } from "@/lib/supabase/client";
import {
  adminRejectClaim,
  adminResolveGame,
  adminSetScore,
  adminStartGame,
  claimGame,
  claimNoShow,
  confirmClaim,
  disputeClaim,
  enterMatch,
  markReady,
  postRoomId,
  readyForDraw,
  type MatchFormState,
} from "./actions";

type Action = (state: MatchFormState, formData: FormData) => Promise<MatchFormState>;

interface Target {
  matchId: string;
  slug: string;
}

function Submit({
  label,
  variant = "primary",
  icon,
  confirm,
}: {
  label: string;
  variant?: "primary" | "ghost" | "danger" | "win";
  icon?: ReactNode;
  /** Pide confirmación antes de enviar. */
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  const styles = {
    primary: "bg-brand text-white shadow-[0_0_18px_-8px_var(--color-brand)] hover:brightness-110",
    ghost: "border border-line text-ink hover:border-brand",
    danger: "border border-bad/60 bg-bad/10 text-bad hover:bg-bad/20",
    win: "bg-win text-surface-0 shadow-[0_0_18px_-8px_var(--color-win)] hover:brightness-110",
  }[variant];
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-50 ${styles}`}
    >
      {pending ? "Un momento…" : (
        <>
          {icon}
          {label}
        </>
      )}
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
  // Si la acción falla, lo escrito vuelve al campo en vez de perderse.
  const formRef = useRef<HTMLFormElement>(null);
  useFormDraft(formRef, null, state);
  return (
    <form ref={formRef} action={formAction} className={className ?? "space-y-3"}>
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

export function RoomIdForm({
  current,
  label = "ID de la sala que creaste en MLBB",
  ...target
}: Target & { current: string | null; label?: string }) {
  return (
    <MatchForm action={postRoomId} target={target}>
      <div>
        <label className="label" htmlFor="roomId">
          {label}
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
      <Submit label="Mi equipo está listo" variant="win" />
    </MatchForm>
  );
}

/** Vencido el plazo sin sala, el capitán rival se queda con la partida. */
export function NoShowForm({ gameNo, rival, ...target }: Target & { gameNo: number; rival: string }) {
  return (
    <MatchForm action={claimNoShow} target={target}>
      <Submit
        label={`Reclamar victoria de la partida ${gameNo}`}
        variant="win"
        icon={<TrophyIcon size={16} />}
        confirm={`${rival} no publicó la sala a tiempo. ¿Reclamar la partida ${gameNo}?`}
      />
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
        className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-win px-4 py-2.5 text-sm font-bold text-surface-0 shadow-[0_0_18px_-8px_var(--color-win)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
      >
        <TrophyIcon size={16} />
        {busy ? "Subiendo captura…" : `Reportar victoria de la partida ${gameNo}`}
      </button>
      <Feedback state={state} />
    </div>
  );
}

/** El capitán rival acepta el resultado reportado. */
export function ConfirmForm({ claimTeam, ...target }: Target & { claimTeam: string }) {
  return (
    <MatchForm action={confirmClaim} target={target}>
      <p className="text-sm text-ink-dim">¿Es correcto? Si confirmas, la partida queda registrada.</p>
      <Submit label={`Sí, ganó ${claimTeam}`} variant="win" icon={<TrophyIcon size={16} />} />
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

/**
 * Cuenta regresiva hasta la hora programada del enfrentamiento. Al llegar a
 * cero vuelve a pedir la página: recién ahí corre el plazo para la sala.
 */
export function StartCountdown({ startsAt, serverNow }: { startsAt: string; serverNow: string }) {
  const router = useRouter();
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const offset = Date.parse(serverNow) - Date.now();
    const target = Date.parse(startsAt);
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

  const total = left === null ? null : Math.ceil(left / 1000);
  const parts =
    total === null
      ? null
      : [
          { value: Math.floor(total / 86400), unit: "d" },
          { value: Math.floor((total % 86400) / 3600), unit: "h" },
          { value: Math.floor((total % 3600) / 60), unit: "m" },
          { value: total % 60, unit: "s" },
        ];

  return (
    <div className="card flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-brand/40 bg-brand/5 px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Empieza en</span>
      <span className="font-mono text-2xl font-semibold tabular-nums" aria-live="off">
        {parts
          ? parts
              .filter((p, i) => i > 0 || p.value > 0)
              .map((p) => `${String(p.value).padStart(2, "0")}${p.unit}`)
              .join(" ")
          : "--"}
      </span>
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
      <Submit label="Disputar resultado" variant="danger" icon={<FlagIcon size={16} />} />
    </MatchForm>
  );
}

/** Copia con la API del portapapeles y, si no está (http, navegadores viejos), a la antigua. */
async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export function CopyButton({
  value,
  label = "Copiar",
  prominent = false,
}: {
  value: string;
  label?: string;
  /** Botón grande y de color, para el ID de sala. */
  prominent?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void copyText(value).then((ok) => {
          if (!ok) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      aria-live="polite"
      className={
        prominent
          ? `inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white transition sm:w-auto ${
              copied
                ? "bg-win shadow-[0_0_18px_-6px_var(--color-win)]"
                : "bg-brand shadow-[0_0_18px_-6px_var(--color-brand)] hover:brightness-110"
            }`
          : "rounded-md border border-line px-2 py-1 text-xs text-ink-dim transition hover:border-brand hover:text-ink"
      }
    >
      {prominent ? (
        <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {copied ? (
            <path d="M5 12l5 5L20 7" />
          ) : (
            <>
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </>
          )}
        </svg>
      ) : null}
      {copied ? "Copiado" : label}
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

interface DrawTeam {
  name: string;
  tag: string;
  logo_path: string | null;
}

/** Cambios de lado de la ruleta: par termina en A, impar en B. */
const DRAW_KEYFRAMES = `
@keyframes host-pop { 0% { transform: scale(.9) } 55% { transform: scale(1.12) } 100% { transform: scale(1.05) } }
@keyframes host-rise { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
@keyframes host-burst { from { opacity: 1; transform: translate(-50%, -50%) scale(1) }
  to { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(.4) } }
`;

const BURST_COLORS = ["var(--color-win)", "var(--color-brand)", "var(--color-warn)"];

/** Antes del sorteo: cada capitán avisa que está listo; el admin puede forzarlo. */
function DrawWaiting({
  ready,
  mySide,
  isAdmin,
  target,
  team,
}: {
  ready: { a: boolean; b: boolean };
  mySide: MatchSide | null;
  isAdmin: boolean;
  target: Target;
  team: (side: MatchSide) => DrawTeam | null;
}) {
  const iAmReady = mySide ? ready[mySide] : false;
  const rival = mySide ? team(mySide === "a" ? "b" : "a") : null;
  return (
    <div className="space-y-3 text-center">
      <p className="text-sm text-ink-dim">
        {mySide
          ? iAmReady
            ? `Esperando a que ${rival?.name ?? "el rival"} esté listo para sortear.`
            : "Cuando los dos capitanes estén listos, se sortea quién crea la sala."
          : "Los capitanes tienen que estar listos para hacer el sorteo."}
      </p>
      {mySide && !iAmReady ? (
        <MatchForm action={readyForDraw} target={target} className="flex flex-col items-center gap-2">
          <Submit label="Listo para el sorteo" icon={<DiceIcon size={16} />} />
        </MatchForm>
      ) : null}
      {isAdmin && !mySide ? (
        <MatchForm action={readyForDraw} target={target} className="flex flex-col items-center gap-2">
          <Submit label="Sortear ahora (admin)" variant="ghost" />
        </MatchForm>
      ) : null}
    </div>
  );
}

/** Destellos que salen del equipo elegido al revelar el sorteo. */
function Burst() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 motion-reduce:hidden">
      {Array.from({ length: 14 }, (_, i) => {
        const angle = (i / 14) * Math.PI * 2;
        const dist = 56 + (i % 3) * 14;
        return (
          <span
            key={i}
            className="absolute top-1/2 left-1/2 size-1.5 rounded-full"
            style={
              {
                background: BURST_COLORS[i % BURST_COLORS.length],
                "--dx": `${Math.cos(angle) * dist}px`,
                "--dy": `${Math.sin(angle) * dist}px`,
                animation: "host-burst 0.8s ease-out forwards",
              } as CSSProperties
            }
          />
        );
      })}
    </span>
  );
}

const DRAW_STEPS = 16;

/**
 * Sorteo en vivo de quién crea la sala de la partida decisiva. El resultado ya lo decidió la
 * base de datos: esto solo lo revela. Se reproduce cada vez que se entra a la
 * sala; después queda el resultado fijo con opción de verlo de nuevo.
 */
export function HostDraw({
  gameNo,
  winner,
  teamA,
  teamB,
  ready,
  mySide,
  isAdmin,
  target,
}: {
  gameNo: number;
  /** null: el sorteo todavía no se hizo; se espera a los dos capitanes. */
  winner: MatchSide | null;
  teamA: DrawTeam | null;
  teamB: DrawTeam | null;
  ready: { a: boolean; b: boolean };
  /** Lado que capitanea quien mira, si juega este partido. */
  mySide: MatchSide | null;
  isAdmin: boolean;
  target: Target;
}) {
  // null: todavía sin montar (el servidor no sabe si este navegador ya lo vio).
  const [lit, setLit] = useState<MatchSide | null>(null);
  const [done, setDone] = useState(false);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!winner) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));

    if (reduced) {
      later(() => {
        setLit(winner);
        setDone(true);
      }, 0);
      return () => timers.forEach(clearTimeout);
    }

    // Arranca en el lado contrario para que el último paso caiga en el ganador.
    const steps = DRAW_STEPS + (winner === "a" ? 0 : 1);
    let at = 0;
    later(() => setDone(false), 0);
    for (let i = 0; i <= steps; i++) {
      // Empieza rápido y frena, como una ruleta.
      at += 70 + i * i * 1.4;
      const side: MatchSide = i % 2 === 0 ? "a" : "b";
      later(() => setLit(side), at);
    }
    later(() => setDone(true), at + 350);

    return () => timers.forEach(clearTimeout);
  }, [run, winner]);

  const team = (side: MatchSide) => (side === "a" ? teamA : teamB);
  const spinning = !done && lit !== null;

  const card = (side: MatchSide) => {
    const t = team(side);
    const on = lit === side;
    const picked = done && side === winner;
    return (
      <div
        className={`relative flex flex-col items-center gap-2 rounded-xl border-2 p-3 text-center transition-all duration-150 ${
          picked
            ? "animate-[host-pop_0.6s_ease-out] border-win bg-win/10 shadow-[0_0_32px_-4px_var(--color-win)]"
            : on || (!winner && ready[side])
              ? "scale-[1.03] border-brand bg-brand/15 shadow-[0_0_20px_-6px_var(--color-brand)]"
              : done
                ? "scale-95 border-line opacity-35 grayscale"
                : "border-line"
        }`}
      >
        {picked ? <Burst /> : null}
        <TeamLogo name={t?.name} tag={t?.tag} path={t?.logo_path} size={52} className="rounded-lg" />
        <span className="line-clamp-2 text-sm font-semibold">{t?.name ?? "—"}</span>
        {picked ? (
          <span className="rounded-full bg-win px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-surface-0">
            Crea la sala
          </span>
        ) : !winner ? (
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              ready[side] ? "border-win/50 bg-win/10 text-win" : "border-line text-ink-faint"
            }`}
          >
            {ready[side] ? "Listo" : "Esperando"}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <div className="relative space-y-4 overflow-hidden rounded-xl border border-brand/40 bg-gradient-to-b from-brand/10 to-transparent p-4">
      <style>{DRAW_KEYFRAMES}</style>
      <p className="flex items-center justify-center gap-1.5 text-center text-xs font-semibold uppercase tracking-[0.2em] text-brand">
        <FlameIcon size={14} className="text-warn" /> Partida decisiva · sorteo de la sala
      </p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {card("a")}
        <div
          aria-hidden
          className={`flex size-11 items-center justify-center rounded-full border border-line bg-surface-2 text-brand ${
            spinning ? "animate-spin" : ""
          }`}
        >
          {done ? <span className="font-display text-xs text-ink-faint">VS</span> : <DiceIcon size={22} />}
        </div>
        {card("b")}
      </div>
      {!winner ? (
        <DrawWaiting ready={ready} mySide={mySide} isAdmin={isAdmin} target={target} team={team} />
      ) : null}
      <p className="min-h-6 text-center" aria-live="polite">
        {!winner ? null : done ? (
          <span className="animate-[host-rise_0.5s_ease-out] inline-block text-base">
            ¡<span className="font-bold text-win">{team(winner)?.name}</span> crea la sala de la
            partida {gameNo}!
          </span>
        ) : spinning ? (
          <span className="text-sm text-ink-dim">Sorteando…</span>
        ) : null}
      </p>
      {winner && done ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setRun((n) => n + 1)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-brand/50 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand transition hover:bg-brand/20 hover:text-ink"
          >
            <DiceIcon size={14} />
            Ver el sorteo otra vez
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Controles del admin dentro de la sala: arrancar la partida, adjudicarla,
 * rechazar un reporte y fijar el marcador de la serie.
 */
export function AdminControls({
  target,
  tournamentId,
  scheduledAt,
  isFinal,
  teamA,
  teamB,
  score,
  winsNeeded,
  bestOf,
  done,
  game,
}: {
  target: Target;
  tournamentId: string;
  scheduledAt: string | null;
  isFinal: boolean;
  teamA: string;
  teamB: string;
  score: { a: number; b: number };
  winsNeeded: number;
  bestOf: number;
  done: boolean;
  /** Partida en curso, si la hay. */
  game: { id: string; gameNo: number; claimSide: MatchSide | null; canStart: boolean } | null;
}) {
  const name = (side: MatchSide) => (side === "a" ? teamA : teamB);
  return (
    <section className="card animate-rise space-y-5 border-brand/40 p-6">
      <div>
        <h2 className="font-semibold">Controles del admin</h2>
        <p className="mt-0.5 text-sm text-ink-dim">
          Lo que hagas aquí queda registrado y los capitanes lo ven al instante.
        </p>
      </div>

      {!done ? (
        <div className="space-y-2 border-t border-line pt-4">
          <p className="text-sm font-semibold">{isFinal ? "Fecha de la final" : "Fecha del enfrentamiento"}</p>
          <p className="text-xs text-ink-faint">
            El plazo de 5 minutos para publicar la sala de la partida 1 no corre antes de esta hora.
          </p>
          <ScheduleForm matchId={target.matchId} tournamentId={tournamentId} current={scheduledAt} />
        </div>
      ) : null}

      {game ? (
        <div className="space-y-3 border-t border-line pt-4">
          <p className="text-sm font-semibold">Partida {game.gameNo}</p>
          <div className="flex flex-wrap items-start gap-2">
            {game.canStart ? (
              <MatchForm action={adminStartGame} target={target}>
                <Submit
                  label="Iniciar ya (saltar preparación)"
                  variant="ghost"
                  confirm={`¿Empezar la partida ${game.gameNo} ahora?`}
                />
              </MatchForm>
            ) : null}
            {(["a", "b"] as const).map((side) => (
              <MatchForm key={side} action={adminResolveGame} target={target}>
                <input type="hidden" name="gameId" value={game.id} />
                <input type="hidden" name="winner" value={side} />
                <Submit
                  label={`Gana ${name(side)}`}
                  variant={game.claimSide === side ? "win" : "ghost"}
                  icon={<TrophyIcon size={16} />}
                  confirm={`¿Dar la partida ${game.gameNo} a ${name(side)}?`}
                />
              </MatchForm>
            ))}
            {game.claimSide ? (
              <MatchForm action={adminRejectClaim} target={target}>
                <input type="hidden" name="gameId" value={game.id} />
                <Submit
                  label="Rechazar reporte"
                  variant="danger"
                  confirm="Se borra el reporte y el capitán puede volver a reportar. ¿Continuar?"
                />
              </MatchForm>
            ) : null}
          </div>
        </div>
      ) : null}

      <MatchForm
        key={`${score.a}-${score.b}`}
        action={adminSetScore}
        target={target}
        className="space-y-3 border-t border-line pt-4">
        <div>
          <p className="text-sm font-semibold">Cambiar el marcador</p>
          <p className="mt-0.5 text-xs text-ink-faint">
            {done
              ? `El partido terminó: puedes corregir el marcador, pero el ganador sigue con ${winsNeeded}.`
              : `Bo${bestOf}: si un equipo llega a ${winsNeeded}, la serie se cierra y avanza en el cuadro. La partida en curso vuelve a empezar.`}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {(["a", "b"] as const).map((side) => (
            <div key={side}>
              <label className="label" htmlFor={`admin-score-${side}`}>
                {name(side)}
              </label>
              <input
                id={`admin-score-${side}`}
                name={side === "a" ? "scoreA" : "scoreB"}
                type="number"
                min={0}
                max={winsNeeded}
                defaultValue={side === "a" ? score.a : score.b}
                className="field w-20"
                required
              />
            </div>
          ))}
          <Submit label="Guardar marcador" confirm="¿Cambiar el marcador de la serie?" />
        </div>
      </MatchForm>
    </section>
  );
}
