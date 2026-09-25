"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { AdminFormState } from "@/app/admin/actions";

type Action = (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;

function Button({
  label,
  variant,
  confirm,
  disabled,
}: {
  label: string;
  variant: "primary" | "ghost" | "danger";
  confirm?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  const styles = {
    primary: "bg-brand text-white hover:brightness-110",
    ghost: "border border-line text-ink-dim hover:text-ink hover:border-brand",
    danger: "border border-bad/50 text-bad hover:bg-bad/10",
  }[variant];

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-40 ${styles}`}
    >
      {pending ? "…" : label}
    </button>
  );
}

interface Props {
  action: Action;
  /** Campos ocultos que la acción necesita. */
  fields: Record<string, string>;
  label: string;
  variant?: "primary" | "ghost" | "danger";
  confirm?: string;
  disabled?: boolean;
}

/** Botón que dispara una Server Action y muestra su error en línea. */
export function ActionForm({
  action,
  fields,
  label,
  variant = "ghost",
  confirm,
  disabled,
}: Props) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(action, {});

  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button label={label} variant={variant} confirm={confirm} disabled={disabled} />
      {state.error ? <span className="text-xs text-bad">{state.error}</span> : null}
    </form>
  );
}
