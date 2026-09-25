import { setRole } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { createClient, getSession } from "@/lib/supabase/server";
import type { Profile } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const supabase = await createClient();
  const session = await getSession();

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  const profiles = (data ?? []) as Profile[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Usuarios</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Un administrador puede crear y operar torneos. Los jugadores solo arman equipos.
        </p>
      </div>

      <ul className="space-y-2">
        {profiles.map((profile) => (
          <li key={profile.id} className="card flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="font-medium">{profile.display_name || "(sin nombre)"}</span>
            <Badge tone={profile.role === "admin" ? "brand" : "neutral"}>
              {profile.role}
            </Badge>
            {profile.id === session?.userId ? (
              <span className="text-xs text-ink-faint">tú</span>
            ) : null}

            <span className="ml-auto">
              {profile.id === session?.userId ? null : (
                <ActionForm
                  action={setRole}
                  fields={{
                    profileId: profile.id,
                    role: profile.role === "admin" ? "user" : "admin",
                  }}
                  label={profile.role === "admin" ? "Quitar admin" : "Hacer admin"}
                  variant={profile.role === "admin" ? "danger" : "ghost"}
                  confirm={
                    profile.role === "admin"
                      ? `¿Quitar permisos de administrador a ${profile.display_name}?`
                      : `¿Dar permisos de administrador a ${profile.display_name}?`
                  }
                />
              )}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-xs text-ink-faint">
        El primer administrador se crea con <code>npm run admin:promote</code> (usa la
        service role key), porque hace falta un admin para nombrar al siguiente.
      </p>
    </div>
  );
}
