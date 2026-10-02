import "server-only";

import { EVIDENCE_BUCKET } from "@/lib/evidence";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * URLs firmadas (1 h) de capturas del bucket privado. Llamar SOLO después de
 * comprobar que quien mira tiene acceso: usa el service role.
 */
export async function signedEvidenceUrls(
  paths: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  if (unique.length === 0) return new Map();

  const { data, error } = await createAdminClient()
    .storage.from(EVIDENCE_BUCKET)
    .createSignedUrls(unique, 60 * 60);
  if (error || !data) {
    console.error("[evidence] no se pudieron firmar las capturas:", error);
    return new Map();
  }

  return new Map(
    data.flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])),
  );
}
