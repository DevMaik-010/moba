/** Bucket público de Supabase Storage con los logos de equipo (ver 0009). */
export const TEAM_LOGO_BUCKET = "team-logos";

export const TEAM_LOGO_MAX_BYTES = 1024 * 1024;

export const TEAM_LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** URL pública de un logo a partir de la ruta guardada en la base. */
export function teamLogoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${TEAM_LOGO_BUCKET}/${path}`;
}
