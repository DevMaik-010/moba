import Link from "next/link";

import { signUp } from "../actions";
import { AuthForm } from "../auth-form";

export default function RegistroPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Crear cuenta</h1>
      <p className="mt-1 mb-6 text-sm text-ink-dim">
        Te registras como jugador con tu ID de MLBB. Lo verificamos al momento; si no se
        puede, un administrador lo revisa.
      </p>

      <AuthForm action={signUp} submitLabel="Crear cuenta" signup />

      <p className="mt-6 text-center text-sm text-ink-dim">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="font-medium text-brand hover:underline">
          Iniciar sesión
        </Link>
      </p>
    </>
  );
}
