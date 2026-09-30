/**
 * Cookie donde queda el código de acceso a la sala de un partido, una vez que
 * alguien lo ingresó bien. La página lo reenvía a get_match_room en cada carga:
 * la base de datos decide si sigue siendo válido.
 */
export function matchCodeCookie(matchId: string): string {
  return `match_code_${matchId}`;
}

export function matchPath(slug: string, matchId: string): string {
  return `/torneos/${slug}/partido/${matchId}`;
}
