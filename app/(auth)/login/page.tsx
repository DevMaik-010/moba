import Link from "next/link";

import { signIn } from "../actions";
import { AuthForm } from "../auth-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;

  return (
    <>
      <h1 className="text-xl font-semibold">Iniciar sesión</h1>
      <p className="mt-1 mb-6 text-sm text-ink-dim">
        Entra para armar tu equipo e inscribirte a un torneo.
      </p>

      <AuthForm
        action={signIn}
        submitLabel="Entrar"
        next={typeof next === "string" ? next : undefined}
      />

      <p className="mt-6 text-center text-sm text-ink-dim">
        ¿No tienes cuenta?{" "}
        <Link href="/registro" className="font-medium text-brand hover:underline">
          Crear una
        </Link>
      </p>
    </>
  );
}
