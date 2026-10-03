"use client";

import { createClient } from "@/lib/supabase/client";
import { TEAM_LOGO_BUCKET, TEAM_LOGO_MAX_BYTES, TEAM_LOGO_TYPES } from "@/lib/team-logo";

const SIDE = 256;
/** Antes de reducirla; la imagen final pesa unos pocos KB. */
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

export const TEAM_LOGO_ACCEPT = Object.keys(TEAM_LOGO_TYPES).join(",");

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

/**
 * Sube el logo al bucket, dentro de la carpeta del usuario (las políticas de
 * Storage no dejan escribir en otra), y devuelve la ruta para guardarla.
 * Lanza un Error con un mensaje para mostrar si algo falla.
 */
export async function uploadTeamLogo(ownerId: string, file: File, prefix: string): Promise<string> {
  if (!(file.type in TEAM_LOGO_TYPES)) throw new Error("Usa una imagen PNG, JPG o WebP");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("La imagen pesa demasiado (máximo 8 MB)");

  const blob = await toSquareWebp(file);
  if (blob.size > TEAM_LOGO_MAX_BYTES) throw new Error("El logo quedó demasiado pesado");

  // Nombre nuevo en cada subida: evita la caché del CDN con el logo viejo, y por
  // eso el archivo puede guardarse en el navegador un año sin revalidar.
  const path = `${ownerId}/${prefix}-${Date.now()}.webp`;
  const { error } = await createClient()
    .storage.from(TEAM_LOGO_BUCKET)
    .upload(path, blob, { contentType: "image/webp", upsert: false, cacheControl: "31536000" });
  if (error) throw new Error(error.message);
  return path;
}
