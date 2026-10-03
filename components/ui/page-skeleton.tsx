/**
 * Esqueleto genérico mientras el servidor arma la página: la navegación se
 * siente inmediata en vez de quedarse congelada en la página anterior.
 */
export function PageSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando…</span>
      <div className="space-y-3">
        <div className="h-3 w-40 rounded-full bg-surface-3" />
        <div className="h-8 w-64 max-w-full rounded-lg bg-surface-3" />
        <div className="h-3 w-80 max-w-full rounded-full bg-surface-2" />
      </div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: cards }, (_, i) => (
          <li key={i} className="card space-y-4 p-5">
            <div className="h-5 w-2/3 rounded-md bg-surface-3" />
            <div className="grid grid-cols-3 gap-2">
              <div className="h-8 rounded-md bg-surface-2" />
              <div className="h-8 rounded-md bg-surface-2" />
              <div className="h-8 rounded-md bg-surface-2" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
