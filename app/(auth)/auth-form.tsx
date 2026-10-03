"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import { precheckGameId, type AuthFormState, type GameIdCheck } from "./actions";

function Submit({ label, signup }: { label: string; signup?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
    >
      {pending ? (signup ? "Verificando tu ID…" : "Un momento…") : label}
    </button>
  );
}

const RESULT_COPY = {
  verified: {
    tone: "border-win/40 text-win",
    icon: "✓",
    title: "¡Cuenta verificada!",
    body: "Tu ID de jugador existe en MLBB. Ya puedes armar tu equipo e inscribirte en torneos.",
    cta: "Ir a los torneos",
    href: "/torneos",
  },
  pending: {
    tone: "border-warn/40 text-warn",
    icon: "…",
    title: "Cuenta en revisión",
    body: "No pudimos confirmar tu ID automáticamente: un administrador lo revisará. Mientras tanto puedes armar tu equipo, pero no inscribirte en torneos.",
    cta: "Ver mi perfil",
    href: "/perfil",
  },
  confirm_email: {
    tone: "border-brand/40 text-brand",
    icon: "@",
    title: "Confirma tu correo",
    body: "Te enviamos un enlace de confirmación. Ábrelo y luego inicia sesión.",
    cta: "Ir a iniciar sesión",
    href: "/login",
  },
} as const;

/** Resultado del registro: verificada, en revisión o pendiente de confirmar correo. */
function SignupResult({ created }: { created: NonNullable<AuthFormState["created"]> }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const copy = RESULT_COPY[created.status];

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  function go() {
    router.push(copy.href);
    router.refresh();
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="signup-result-title"
      // Escape cierra el modal: se sigue igual que con el botón.
      onCancel={(e) => {
        e.preventDefault();
        go();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-line bg-surface-1 p-6 text-ink backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div
        aria-hidden
        className={`mx-auto flex size-12 items-center justify-center rounded-full border-2 text-xl font-bold ${copy.tone}`}
      >
        {copy.icon}
      </div>
      <h2 id="signup-result-title" className="mt-4 text-center text-lg font-semibold">
        {copy.title}
      </h2>
      {created.nickname ? (
        <p className="mt-1 text-center text-sm">
          Bienvenido, <span className="font-semibold text-brand">{created.nickname}</span>
        </p>
      ) : null}
      <p className="mt-3 text-center text-sm text-ink-dim">{copy.body}</p>
      <button
        type="button"
        autoFocus
        onClick={go}
        className="mt-6 w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
      >
        {copy.cta}
      </button>
    </dialog>
  );
}

const GAME_USER_ID = /^[0-9]{5,12}$/;
const ZONE_ID = /^[0-9]{3,6}$/;
/** Espera tras la última tecla antes de consultar, para no gastar cupo en cada dígito. */
const PRECHECK_DELAY_MS = 600;

const CHECK_COPY: Record<GameIdCheck["status"], { tone: string; text: string }> = {
  valid: { tone: "text-win", text: "✓ Cuenta encontrada" },
  invalid: { tone: "text-bad", text: "✗ Ese ID no existe en ese servidor. Revisa los dos números." },
  taken: { tone: "text-bad", text: "✗ Ese ID de jugador ya está registrado en otra cuenta" },
  unavailable: {
    tone: "text-warn",
    text: "No pudimos verificarlo ahora; si creas la cuenta, un administrador lo revisará.",
  },
  rate_limited: { tone: "text-warn", text: "Demasiadas consultas. Espera un rato." },
};

/**
 * ID y servidor de MLBB. Verifica en segundo plano en cuanto los dos tienen
 * formato válido: el usuario ve su nick antes de enviar y signUp encuentra el
 * veredicto ya en caché.
 */
function GameIdFields({
  defaultGameUserId,
  defaultZoneId,
}: {
  defaultGameUserId?: string;
  defaultZoneId?: string;
}) {
  const [gameUserId, setGameUserId] = useState(defaultGameUserId ?? "");
  const [zoneId, setZoneId] = useState(defaultZoneId ?? "");
  const [check, setCheck] = useState<{ key: string; result: GameIdCheck } | null>(null);

  const id = gameUserId.trim();
  const zone = zoneId.trim();
  const key = GAME_USER_ID.test(id) && ZONE_ID.test(zone) ? `${id}:${zone}` : null;

  useEffect(() => {
    if (!key) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const result = await precheckGameId(id, zone);
      if (!stale) setCheck({ key, result });
    }, PRECHECK_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [key, id, zone]);

  // Solo se muestra el veredicto del par que hay escrito ahora mismo.
  const result = key && check?.key === key ? check.result : null;
  const copy = result ? CHECK_COPY[result.status] : null;

  return (
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
            defaultValue={defaultGameUserId}
            onChange={(e) => setGameUserId(e.target.value)}
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
            defaultValue={defaultZoneId}
            onChange={(e) => setZoneId(e.target.value)}
            required
          />
        </div>
      </div>
      <p aria-live="polite" className="min-h-4 text-xs">
        {key && !result ? <span className="text-ink-dim">Verificando ID…</span> : null}
        {copy ? (
          <span className={copy.tone}>
            {copy.text}
            {result?.status === "valid" && result.nickname ? (
              <>
                : <span className="font-semibold">{result.nickname}</span>
              </>
            ) : null}
          </span>
        ) : null}
      </p>
      <p className="text-xs text-ink-faint">
        Están en tu perfil dentro del juego. Tu nombre en la plataforma será tu nick de MLBB.
        Un ID solo puede estar en una cuenta.
      </p>
    </fieldset>
  );
}

interface Props {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  submitLabel: string;
  /** Registro: pide el ID de MLBB y muestra el resultado en un modal. */
  signup?: boolean;
  next?: string;
}

export function AuthForm({ action, submitLabel, signup, next }: Props) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(action, {});
  const values = state.values ?? {};

  return (
    <>
      {state.created ? <SignupResult created={state.created} /> : null}

      <form action={formAction} className="space-y-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}

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
            autoComplete={signup ? "new-password" : "current-password"}
            className="field"
            placeholder="Mínimo 8 caracteres"
            required
            minLength={8}
          />
        </div>

        {signup ? (
          <GameIdFields
            defaultGameUserId={values.gameUserId}
            defaultZoneId={values.zoneId}
          />
        ) : null}

        {state.error ? (
          <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
            {state.error}
          </p>
        ) : null}

        <Submit label={submitLabel} signup={signup} />
      </form>
    </>
  );
}
