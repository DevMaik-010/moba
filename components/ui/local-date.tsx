"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

interface Props {
  iso: string;
  options: Intl.DateTimeFormatOptions;
}

/**
 * Fecha en la zona horaria de quien la mira. En el servidor no se sabe cuál es,
 * así que ahí no se pinta nada y el texto aparece al hidratar.
 */
export function LocalDate({ iso, options }: Props) {
  const text = useSyncExternalStore(
    noopSubscribe,
    () => new Date(iso).toLocaleString("es", options),
    () => "",
  );
  return <time dateTime={iso}>{text}</time>;
}
