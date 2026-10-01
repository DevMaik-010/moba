"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import { ValidationBadge } from "@/components/ui/badge";
import type { CaptainInfo } from "@/lib/account";
import { TeamLogo } from "@/components/ui/team-logo";
import { TEAM_LOGO_ACCEPT, uploadTeamLogo } from "@/lib/team-logo-upload";
import { TEAM_SIZE_BY_MODE } from "@/lib/db/types";
import type {
  SavedTeam,
  SavedTeamMember,
  TournamentMode,
  ValidationStatus,
} from "@/lib/db/types";
import { saveSavedTeam, type SavedTeamFormState } from "./actions";

interface RowState {
  gameUserId: string;
  zoneId: string;
  status: ValidationStatus | null;
  nickname: string | null;
  checking: boolean;
  message: string | null;
}

interface Props {
  captain: CaptainInfo;
  /** Si viene, se edita ese equipo; si no, se crea uno nuevo. */
  team?: SavedTeam;
  members?: SavedTeamMember[];
  defaultMode?: TournamentMode;
  /** Ruta interna a la que volver al guardar (p. ej. la inscripción a un torneo). */
  returnTo?: string;
}

const MAX_SIZE = Math.max(...Object.values(TEAM_SIZE_BY_MODE));

function emptyRow(): RowState {
  return {
    gameUserId: "",
    zoneId: "",
    status: null,
    nickname: null,
    checking: false,
    message: null,
  };
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
    >
      {pending ? "Verificando y guardando…" : label}
    </button>
  );
}

/**
 * Logo opcional al crear el equipo: se sube en cuanto se elige (a la carpeta
 * del usuario) y su ruta viaja en el formulario.
 */
function LogoPicker({ ownerId, name }: { ownerId: string; name: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    startTransition(async () => {
      try {
        setPath(await uploadTeamLogo(ownerId, file, "nuevo"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo subir el logo");
      } finally {
        if (input.current) input.current.value = "";
      }
    });
  }

  return (
    <div>
      <span className="label">Logo (opcional)</span>
      <div className="flex flex-wrap items-center gap-3">
        <TeamLogo name={name || "Equipo"} path={path} size={56} className="rounded-xl" />
        <label
          className={`cursor-pointer rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-dim transition hover:border-brand hover:text-ink ${
            busy ? "pointer-events-none opacity-50" : ""
          }`}
        >
          {busy ? "Subiendo…" : path ? "Cambiar imagen" : "Elegir imagen"}
          <input
            ref={input}
            type="file"
            accept={TEAM_LOGO_ACCEPT}
            className="sr-only"
            disabled={busy}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        {path ? (
          <button
            type="button"
            onClick={() => setPath(null)}
            className="text-sm text-ink-faint transition hover:text-bad"
          >
            Quitar
          </button>
        ) : null}
        <span className="text-xs text-ink-faint">PNG, JPG o WebP · se recorta cuadrado</span>
      </div>
      {path ? <input type="hidden" name="logoPath" value={path} /> : null}
      {error ? <p className="mt-1 text-sm text-bad">{error}</p> : null}
    </div>
  );
}

export function TeamEditor({
  captain,
  team,
  members = [],
  defaultMode = "5v5",
  returnTo,
}: Props) {
  // El modo de un equipo existente no cambia: su roster tiene ese tamaño.
  const [mode, setMode] = useState<TournamentMode>(team?.mode ?? defaultMode);
  const size = TEAM_SIZE_BY_MODE[mode];

  // Siempre hay filas para el modo más grande; se muestran solo las del modo
  // elegido, así cambiar de modo al crear no borra lo ya escrito. La fila 0 es
  // el capitán (la cuenta) y no se edita.
  const [rows, setRows] = useState<RowState[]>(() =>
    Array.from({ length: MAX_SIZE }, (_, i) => {
      const existing = members.find((m) => m.slot === i + 1);
      if (!existing) return emptyRow();
      return {
        gameUserId: existing.game_user_id,
        zoneId: existing.zone_id,
        status: existing.validation_status,
        nickname: existing.nickname,
        checking: false,
        message: null,
      };
    }),
  );

  const [state, action] = useActionState<SavedTeamFormState, FormData>(saveSavedTeam, {});
  const [teamName, setTeamName] = useState(team?.name ?? "");

  function update(index: number, patch: Partial<RowState>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  /** Consulta el ID contra el proveedor para dar feedback antes de guardar. */
  async function checkRow(index: number) {
    const row = rows[index];
    if (!/^[0-9]{5,12}$/.test(row.gameUserId) || !/^[0-9]{3,6}$/.test(row.zoneId)) {
      return;
    }

    update(index, { checking: true, message: null });

    try {
      const response = await fetch("/api/mlbb/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameUserId: row.gameUserId, zoneId: row.zoneId }),
      });
      const data = await response.json();

      if (!response.ok) {
        update(index, {
          checking: false,
          status: "pending",
          message: data.error ?? "No se pudo verificar ahora",
        });
        return;
      }

      update(index, {
        checking: false,
        status: data.status as ValidationStatus,
        nickname: data.nickname,
        message:
          data.lookupStatus === "unavailable"
            ? "El verificador no respondió. Un admin lo revisará."
            : null,
      });
    } catch {
      update(index, {
        checking: false,
        status: "pending",
        message: "Sin conexión con el verificador",
      });
    }
  }

  // Índices reales de las filas que se cargan a mano: 1 .. size-1.
  const visible = rows.slice(1, size).map((row, i) => ({ row, index: i + 1 }));
  const rejected = visible.filter(
    ({ row }) => row.status === "invalid" || row.status === "manual_rejected",
  ).length;

  return (
    <form action={action} className="card space-y-5 p-6">
      {team ? <input type="hidden" name="savedTeamId" value={team.id} /> : null}
      {returnTo ? <input type="hidden" name="volver" value={returnTo} /> : null}

      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <div>
          <label className="label" htmlFor="name">
            Nombre del equipo
          </label>
          <input
            id="name"
            name="name"
            className="field"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Los Invocadores"
            required
            minLength={2}
            maxLength={40}
          />
        </div>
        <div>
          <label className="label" htmlFor="tag">
            Tag
          </label>
          <input
            id="tag"
            name="tag"
            className="field"
            defaultValue={team?.tag ?? ""}
            placeholder="INV"
            maxLength={6}
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="mode">
          Modo
        </label>
        {team ? (
          <>
            <input type="hidden" name="mode" value={mode} />
            <p className="font-mono text-sm text-brand">{mode}</p>
            <p className="mt-1 text-xs text-ink-faint">
              El modo no se cambia. Para otro modo, crea otro equipo.
            </p>
          </>
        ) : (
          <select
            id="mode"
            name="mode"
            className="field"
            value={mode}
            onChange={(e) => setMode(e.target.value as TournamentMode)}
          >
            {(Object.keys(TEAM_SIZE_BY_MODE) as TournamentMode[]).map((m) => (
              <option key={m} value={m}>
                {m} — {TEAM_SIZE_BY_MODE[m]}{" "}
                {TEAM_SIZE_BY_MODE[m] === 1 ? "jugador" : "jugadores"}
              </option>
            ))}
          </select>
        )}
      </div>

      {!team ? <LogoPicker ownerId={captain.ownerId} name={teamName} /> : null}

      <div>
        <h2 className="font-semibold">Roster</h2>
        <p className="mt-0.5 mb-3 text-sm text-ink-dim">
          {size === 1
            ? "En 1v1 tu equipo eres tú: no hace falta nadie más."
            : `Tú eres el capitán. Agrega a los otros ${size - 1} integrantes: su ID de juego y servidor (zona) están en su perfil dentro de MLBB.`}
        </p>

        <ul className="space-y-3">
          <li className="rounded-lg border border-brand/40 bg-brand/5 p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-mono text-xs text-brand">C</span>
              <span className="font-semibold">{captain.nickname ?? "Tú"}</span>
              <span className="font-mono text-xs text-ink-dim">
                {captain.gameUserId} · {captain.zoneId}
              </span>
              <span className="text-[11px] uppercase text-brand">capitán · tu cuenta</span>
              <span className="ml-auto">
                <ValidationBadge status={captain.status} />
              </span>
            </div>
          </li>

          {visible.map(({ row, index }) => (
            <li key={index} className="rounded-lg border border-line bg-surface-2 p-3">
              <div className="grid gap-3 sm:grid-cols-[28px_1fr_110px]">
                <span className="hidden self-center font-mono text-xs text-ink-faint sm:block">
                  {index + 1}
                </span>

                <div>
                  <label className="label" htmlFor={`member-${index}-id`}>
                    ID del jugador {index + 1}
                  </label>
                  <input
                    id={`member-${index}-id`}
                    name={`member-${index}-id`}
                    className="field"
                    inputMode="numeric"
                    placeholder="123456789"
                    value={row.gameUserId}
                    onChange={(e) =>
                      update(index, {
                        gameUserId: e.target.value.replace(/\D/g, ""),
                        status: null,
                        nickname: null,
                      })
                    }
                    onBlur={() => void checkRow(index)}
                    required
                  />
                </div>

                <div>
                  <label className="label" htmlFor={`member-${index}-zone`}>
                    Servidor
                  </label>
                  <input
                    id={`member-${index}-zone`}
                    name={`member-${index}-zone`}
                    className="field"
                    inputMode="numeric"
                    placeholder="1234"
                    value={row.zoneId}
                    onChange={(e) =>
                      update(index, {
                        zoneId: e.target.value.replace(/\D/g, ""),
                        status: null,
                        nickname: null,
                      })
                    }
                    onBlur={() => void checkRow(index)}
                    required
                  />
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {row.checking ? (
                  <span className="text-ink-faint">Verificando…</span>
                ) : row.status ? (
                  <>
                    <ValidationBadge status={row.status} />
                    {row.nickname ? (
                      <span className="font-medium text-ink">{row.nickname}</span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-ink-faint">Sin verificar</span>
                )}
                {row.message ? <span className="text-warn">{row.message}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {rejected > 0 ? (
        <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          Hay {rejected} ID rechazado. Puedes guardar, pero no podrás inscribir el equipo
          hasta corregirlo.
        </p>
      ) : null}

      {team ? (
        <p className="text-xs text-ink-faint">
          Los cambios aplican a tus próximas inscripciones. Los torneos donde ya estás
          inscrito conservan el roster con el que entraste.
        </p>
      ) : null}

      {state.error ? (
        <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      ) : null}

      <SubmitButton label={team ? "Guardar cambios" : "Crear equipo"} />
    </form>
  );
}
