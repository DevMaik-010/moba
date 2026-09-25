import Link from "next/link";

import { TournamentBadge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import type { Tournament } from "@/lib/db/types";

export const dynamic = "force-dynamic";

function TournamentList({ tournaments }: { tournaments: Tournament[] }) {
  return (
    <ul className="space-y-2">
      {tournaments.map((t) => (
        <li key={t.id}>
          <Link
            href={`/admin/torneos/${t.id}`}
            className="card flex flex-wrap items-center gap-3 px-4 py-3 transition hover:border-brand/60"
          >
            <span className="font-medium">{t.name}</span>
            <span className="font-mono text-xs text-brand">{t.mode}</span>
            <span className="font-mono text-xs text-ink-faint">{t.bracket_size} cupos</span>
            <span className="ml-auto">
              <TournamentBadge status={t.status} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function AdminHome() {
  const supabase = await createClient();

  const [{ data: tournaments }, { count: pending }] = await Promise.all([
    supabase.from("tournaments").select("*").order("created_at", { ascending: false }),
    supabase
      .from("team_members")
      .select("id", { count: "exact", head: true })
      .eq("validation_status", "pending"),
  ]);

  const list = (tournaments ?? []) as Tournament[];
  const active = list.filter((t) => !t.archived_at);
  const archived = list.filter((t) => t.archived_at);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Torneos</h1>
        <Link
          href="/admin/torneos/nuevo"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
        >
          Nuevo torneo
        </Link>
      </div>

      {(pending ?? 0) > 0 ? (
        <Link
          href="/admin/validaciones"
          className="card block border-warn/40 bg-warn/5 p-4 text-sm"
        >
          <span className="font-semibold text-warn">{pending} ID sin verificar</span>
          <span className="ml-2 text-ink-dim">
            El verificador automático no pudo resolverlos. Revísalos a mano →
          </span>
        </Link>
      ) : null}

      {list.length === 0 ? (
        <div className="card p-10 text-center text-sm text-ink-dim">
          Todavía no has creado ningún torneo.
        </div>
      ) : (
        <TournamentList tournaments={active} />
      )}

      {archived.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer text-sm font-semibold text-ink-dim hover:text-ink">
            Archivados ({archived.length})
          </summary>
          <div className="mt-3">
            <TournamentList tournaments={archived} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
