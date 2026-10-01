"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { TeamLogo } from "@/components/ui/team-logo";
import { TEAM_LOGO_ACCEPT, uploadTeamLogo } from "@/lib/team-logo-upload";
import { setSavedTeamLogo } from "./actions";

interface Props {
  savedTeamId: string;
  ownerId: string;
  name: string;
  tag: string;
  logoPath: string | null;
}

/** Cambia o quita el logo de un equipo que ya existe. */
export function LogoUploader({ savedTeamId, ownerId, name, tag, logoPath }: Props) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function save(path: string | null) {
    startTransition(async () => {
      const result = await setSavedTeamLogo(savedTeamId, path);
      setError(result.error ?? null);
      setNotice(result.notice ?? null);
      router.refresh();
    });
  }

  function onFile(file: File | undefined) {
    setError(null);
    setNotice(null);
    if (!file) return;

    startTransition(async () => {
      try {
        save(await uploadTeamLogo(ownerId, file, savedTeamId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo subir el logo");
      } finally {
        if (input.current) input.current.value = "";
      }
    });
  }

  return (
    <section className="card flex flex-wrap items-center gap-4 p-5">
      <TeamLogo name={name} tag={tag} path={logoPath} size={72} className="rounded-xl" />
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <h2 className="font-semibold">Logo del equipo</h2>
          <p className="text-sm text-ink-dim">
            Se muestra en el cuadro de enfrentamientos. Imagen cuadrada, PNG, JPG o WebP.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label
            className={`cursor-pointer rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 ${
              busy ? "pointer-events-none opacity-50" : ""
            }`}
          >
            {busy ? "Subiendo…" : logoPath ? "Cambiar logo" : "Subir logo"}
            <input
              ref={input}
              type="file"
              accept={TEAM_LOGO_ACCEPT}
              className="sr-only"
              disabled={busy}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          {logoPath ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => save(null)}
              className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-dim transition hover:border-bad/50 hover:text-bad disabled:opacity-50"
            >
              Quitar
            </button>
          ) : null}
        </div>
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        {notice ? <p className="text-sm text-win">{notice}</p> : null}
      </div>
    </section>
  );
}
