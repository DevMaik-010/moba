"use client";

import { createClient } from "@/lib/supabase/client";
import { EVIDENCE_BUCKET, EVIDENCE_MAX_BYTES, EVIDENCE_TYPES } from "@/lib/evidence";

/** Lado mayor de la imagen guardada: legible y liviana. */
const MAX_SIDE = 1920;
/** Antes de reducirla. */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export const EVIDENCE_ACCEPT = Object.keys(EVIDENCE_TYPES).join(",");

/** Reduce la captura a 1920 px de lado mayor, en WebP. */
async function toWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Tu navegador no puede procesar la imagen");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.85),
  );
  if (!blob) throw new Error("No se pudo convertir la imagen");
  return blob;
}

/**
 * Sube la captura a la carpeta del usuario en el bucket privado y devuelve la
 * ruta para mandarla a la RPC. Lanza un Error con un mensaje para mostrar.
 */
export async function uploadEvidence(ownerId: string, file: File, prefix: string): Promise<string> {
  if (!(file.type in EVIDENCE_TYPES)) throw new Error("Usa una imagen PNG, JPG o WebP");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("La imagen pesa demasiado (máximo 20 MB)");

  const blob = await toWebp(file);
  if (blob.size > EVIDENCE_MAX_BYTES) throw new Error("La captura quedó demasiado pesada");

  const path = `${ownerId}/${prefix}-${Date.now()}.webp`;
  const { error } = await createClient()
    .storage.from(EVIDENCE_BUCKET)
    .upload(path, blob, { contentType: "image/webp", upsert: false });
  if (error) throw new Error(error.message);
  return path;
}
