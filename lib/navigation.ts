/**
 * Devuelve la ruta solo si es interna (`/algo`, nunca `//otro-sitio.com`), para
 * que un `?volver=` en la URL no sirva de redirección abierta.
 */
export function safeReturnPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")
    ? value
    : undefined;
}
