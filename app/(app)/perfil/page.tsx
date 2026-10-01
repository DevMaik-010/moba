import { redirect } from "next/navigation";

import { ValidationBadge } from "@/components/ui/badge";
import { accountBlocker, accountState } from "@/lib/account";
import { getSession } from "@/lib/supabase/server";
import { GameAccountForm } from "./game-account-form";

export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/perfil");

  const { profile } = session;
  const state = accountState(profile);
  const blocker = accountBlocker(state);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mi perfil</h1>
        <p className="mt-1 text-sm text-ink-dim">
          {profile.display_name} · {session.email}
        </p>
      </div>

      <section className="card space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Cuenta de MLBB</h2>
          {profile.mlbb_status ? <ValidationBadge status={profile.mlbb_status} /> : null}
        </div>

        {profile.game_user_id ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-faint">ID de jugador</dt>
            <dd className="font-mono">{profile.game_user_id}</dd>
            <dt className="text-ink-faint">Servidor</dt>
            <dd className="font-mono">{profile.zone_id}</dd>
            {profile.mlbb_nickname ? (
              <>
                <dt className="text-ink-faint">Nick</dt>
                <dd className="font-medium">{profile.mlbb_nickname}</dd>
              </>
            ) : null}
          </dl>
        ) : null}

        {blocker ? (
          <p
            className={`rounded-lg border px-3 py-2 text-sm ${
              state === "pending"
                ? "border-warn/40 bg-warn/10 text-warn"
                : "border-bad/40 bg-bad/10 text-bad"
            }`}
          >
            {blocker}
          </p>
        ) : (
          <p className="text-sm text-ink-dim">
            Tu ID está verificado. Para cambiarlo, habla con un administrador.
          </p>
        )}

        {state !== "verified" ? (
          <GameAccountForm
            gameUserId={profile.game_user_id}
            zoneId={profile.zone_id}
            label={
              state === "missing"
                ? "Registrar mi ID"
                : state === "pending"
                  ? "Volver a verificar"
                  : "Guardar ID corregido"
            }
          />
        ) : null}
      </section>
    </div>
  );
}
