"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { TeamLogo } from "@/components/ui/team-logo";
import { createClient } from "@/lib/supabase/client";
import { TEAM_LOGO_BUCKET, TEAM_LOGO_MAX_BYTES, TEAM_LOGO_TYPES } from "@/lib/team-logo";
import { setSavedTeamLogo } from "./actions";

const SIDE = 256;
/** Antes de reducirla; la imagen final pesa unos pocos KB. */
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

interface Props {
  savedTeamId: string;
  ownerId: string;
  name: string;
  tag: string;
  logoPath: string | null;
}

/** Recorta al centro y reduce a un cuadrado de 256 px en WebP. */
async function toSquareWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const crop = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIDE;
  canvas.height = SIDE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Tu navegador no puede procesar la imagen");
  ctx.drawImage(
    bitmap,
    (bitmap.width - crop) / 2,
    (bitmap.height - crop) / 2,
    crop,
    crop,
    0,
    0,
    SIDE,
    SIDE,
  );
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.9),
  );
  if (!blob) throw new Error("No se pudo convertir la imagen");
  return blob;
}

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

  async function onFile(file: File | undefined) {
    setError(null);
    setNotice(null);
    if (!file) return;
    if (!(file.type in TEAM_LOGO_TYPES)) {
      setError("Usa una imagen PNG, JPG o WebP");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setError("La imagen pesa demasiado (máximo 8 MB)");
      return;
    }

    startTransition(async () => {
      try {
        const blob = await toSquareWebp(file);
        if (blob.size > TEAM_LOGO_MAX_BYTES) throw new Error("El logo quedó demasiado pesado");

        // Nombre nuevo en cada subida: evita la caché del CDN con el logo viejo.
        const path = `${ownerId}/${savedTeamId}-${Date.now()}.webp`;
        const { error: uploadError } = await createClient()
          .storage.from(TEAM_LOGO_BUCKET)
          .upload(path, blob, { contentType: "image/webp", upsert: false });
        if (uploadError) throw new Error(uploadError.message);

        save(path);
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
              accept={Object.keys(TEAM_LOGO_TYPES).join(",")}
              className="sr-only"
              disabled={busy}
              onChange={(e) => void onFile(e.target.files?.[0])}
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
