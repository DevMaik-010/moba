import Link from "next/link";

/** Para armar un equipo hace falta el ID de la cuenta: es el capitán. */
export function NeedsGameId() {
  return (
    <div className="card space-y-3 p-6">
      <h2 className="font-semibold">Primero registra tu ID de jugador</h2>
      <p className="text-sm text-ink-dim">
        Tú eres el capitán de los equipos que armas, así que tu ID de MLBB ocupa el puesto 1.
      </p>
      <Link
        href="/perfil"
        className="inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
      >
        Ir a Mi perfil
      </Link>
    </div>
  );
}
