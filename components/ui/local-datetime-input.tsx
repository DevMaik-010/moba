"use client";

import { useEffect, useRef, useState } from "react";

/** `YYYY-MM-DDTHH:mm` en la hora local del navegador, lo que espera `datetime-local`. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props {
  id: string;
  /** Nombre del campo oculto que viaja al servidor, ya en ISO (UTC). */
  name: string;
  defaultIso?: string | null;
  className?: string;
}

/**
 * `datetime-local` no lleva zona horaria: si el servidor lo interpreta, lo hace
 * en SU zona (UTC en producción) y un torneo a las 20:00 de Lima queda a las
 * 15:00. Aquí la conversión la hace el navegador, que sí sabe la zona del
 * organizador, y al servidor llega un instante ISO sin ambigüedad.
 */
export function LocalDateTimeInput({ id, name, defaultIso, className }: Props) {
  const [iso, setIso] = useState(defaultIso ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  // El valor visible depende de la zona del navegador: se pone al montar, así
  // el HTML del servidor (vacío) y el del cliente coinciden al hidratar.
  useEffect(() => {
    if (defaultIso && inputRef.current) {
      inputRef.current.value = toLocalInput(defaultIso);
    }
  }, [defaultIso]);

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="datetime-local"
        className={className}
        onChange={(e) => {
          const value = e.target.value;
          setIso(value ? new Date(value).toISOString() : "");
        }}
      />
      <input type="hidden" name={name} value={iso} />
    </>
  );
}
