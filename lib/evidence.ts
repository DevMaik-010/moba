/** Bucket privado con capturas de resultados y evidencias de reportes (ver 0013). */
export const EVIDENCE_BUCKET = "match-evidence";

export const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;

export const EVIDENCE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
