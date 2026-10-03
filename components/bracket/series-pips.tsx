interface Props {
  /** Partidas ganadas por el equipo. */
  wins: number;
  /** Victorias que hacen falta para llevarse la serie. */
  needed: number;
  /** Va ganando o ya ganó: los puntos llenos se pintan con el color de victoria. */
  leading?: boolean;
  size?: "sm" | "md";
  label?: string;
}

/** Una fila de puntos, uno por victoria necesaria: llenos los ganados. */
export function SeriesPips({ wins, needed, leading, size = "sm", label }: Props) {
  const dot = size === "sm" ? "size-2" : "size-3";
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1"
      role="img"
      aria-label={label ?? `${wins} de ${needed} victorias`}
    >
      {Array.from({ length: needed }, (_, i) => (
        <span
          key={i}
          className={`${dot} rotate-45 rounded-[2px] border transition-colors ${
            i < wins
              ? leading
                ? "border-win bg-win shadow-[0_0_6px_var(--color-win)]"
                : "border-brand bg-brand shadow-[0_0_6px_var(--color-brand)]"
              : "border-line bg-transparent"
          }`}
        />
      ))}
    </span>
  );
}
