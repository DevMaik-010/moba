"use client";

import { useEffect, useMemo, useState } from "react";

import { MatchCard } from "@/components/bracket/match-card";
import { CrownIcon, TrophyIcon } from "@/components/ui/icons";
import { TeamLogo } from "@/components/ui/team-logo";
import { bestOf, roundLabel } from "@/lib/bracket/bracket";
import { matchPath } from "@/lib/match-access";
import { createClient } from "@/lib/supabase/client";
import type { Match, Team } from "@/lib/db/types";

interface Props {
  tournamentId: string;
  initialMatches: Match[];
  initialTeams: Team[];
  /** Resalta al equipo del usuario dentro del cuadro. */
  highlightTeamId?: string | null;
  /** Con el slug, cada cuadrito abre la sala de su enfrentamiento. */
  slug?: string;
}

/**
 * El "]" que une dos partidos con el de la ronda siguiente.
 * Cada par ocupa un `flex-1`, igual que dos filas de partido, así que la mitad
 * central del conector cae exactamente sobre el centro de cada cuadrito.
 */
function Connector({ pairs, lit }: { pairs: number; lit: boolean[] }) {
  return (
    <div className="flex w-10 shrink-0 flex-1 flex-col" aria-hidden>
      {Array.from({ length: pairs }, (_, i) => {
        // Se ilumina cuando ya hay alguien avanzando por esta llave.
        const on = lit[i];
        const line = on ? "border-brand shadow-[0_0_10px_-2px_var(--color-brand)]" : "border-line";
        return (
          <div key={i} className="flex flex-1 items-center">
            <div className={`relative h-1/2 w-1/2 rounded-r-lg border-y-2 border-r-2 ${line}`}>
              <span className={`absolute left-full top-1/2 h-0.5 w-5 -translate-y-1/2 ${on ? "bg-brand" : "bg-line"}`} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const HEADER =
  "mb-3 flex h-7 items-center justify-center gap-1.5 rounded-md border text-[11px] font-bold uppercase tracking-[0.14em]";

export function BracketView({
  tournamentId,
  initialMatches,
  initialTeams,
  highlightTeamId,
  slug,
}: Props) {
  const [matches, setMatches] = useState(initialMatches);
  const [teams, setTeams] = useState(initialTeams);

  // El cuadro se apila solo: cuando otro capitán inscribe su equipo, su
  // cuadrito aparece aquí sin recargar la página.
  useEffect(() => {
    const supabase = createClient();
    const filter = `tournament_id=eq.${tournamentId}`;

    const channel = supabase
      .channel(`bracket:${tournamentId}`)
      .on<Match>(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter },
        (payload) => {
          const row = payload.new as Match;
          if (!row?.id) return;
          setMatches((prev) =>
            prev.some((m) => m.id === row.id)
              ? prev.map((m) => (m.id === row.id ? row : m))
              : [...prev, row],
          );
        },
      )
      .on<Team>(
        "postgres_changes",
        { event: "*", schema: "public", table: "teams", filter },
        (payload) => {
          const row = payload.new as Team;
          if (!row?.id) return;
          setTeams((prev) =>
            prev.some((t) => t.id === row.id)
              ? prev.map((t) => (t.id === row.id ? row : t))
              : [...prev, row],
          );
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tournamentId]);

  const teamsById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  const rounds = useMemo(() => {
    const byRound = new Map<number, Match[]>();
    for (const m of matches) {
      const list = byRound.get(m.round) ?? [];
      list.push(m);
      byRound.set(m.round, list);
    }
    return [...byRound.entries()]
      .sort(([a], [b]) => a - b)
      .map(([round, list]) => ({ round, matches: list.sort((a, b) => a.slot - b.slot) }));
  }, [matches]);

  if (rounds.length === 0) {
    return (
      <div className="card p-10 text-center text-sm text-ink-dim">
        El cuadro se dibuja cuando el administrador abre las inscripciones.
      </div>
    );
  }

  const total = rounds.length;
  const final = rounds[total - 1]?.matches[0];
  const champion =
    final?.status === "done" && final.winner_id ? teamsById.get(final.winner_id) : undefined;

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2">
      <div className="flex min-h-[420px] min-w-max items-stretch">
        {rounds.map(({ round, matches: roundMatches }, index) => (
          <div key={round} className="flex items-stretch">
            <div className="flex w-60 shrink-0 flex-col">
              <p
                className={`${HEADER} ${
                  index === total - 1
                    ? "border-gold/50 bg-gold/10 text-gold"
                    : "border-line bg-surface-1/80 text-ink-dim"
                }`}
              >
                {index === total - 1 ? <TrophyIcon size={13} /> : null}
                {roundLabel(round, total)}
                <span className="font-normal text-ink-faint">· Bo{bestOf(round, total)}</span>
              </p>
              <div className="flex flex-1 flex-col">
                {roundMatches.map((match) => (
                  <div key={match.id} className="flex flex-1 items-center py-1">
                    <MatchCard
                      match={match}
                      teams={teamsById}
                      bestOf={bestOf(round, total)}
                      highlightTeamId={highlightTeamId}
                      href={slug ? matchPath(slug, match.id) : undefined}
                    />
                  </div>
                ))}
              </div>
            </div>

            {index < rounds.length - 1 ? (
              <div className="flex flex-col">
                <p className={`${HEADER} invisible`} aria-hidden />
                <Connector
                  pairs={Math.ceil(roundMatches.length / 2)}
                  lit={Array.from({ length: Math.ceil(roundMatches.length / 2) }, (_, i) =>
                    [roundMatches[i * 2], roundMatches[i * 2 + 1]].some(
                      (m) => m?.status === "done" || (m?.status === "bye" && !!m.winner_id),
                    ),
                  )}
                />
              </div>
            ) : null}
          </div>
        ))}

        <div className="flex items-stretch">
          <div className="flex flex-col">
            <p className={`${HEADER} invisible`} aria-hidden />
            <div className="flex flex-1 items-center" aria-hidden>
              <span className={`h-0.5 w-8 ${champion ? "bg-gold shadow-[0_0_10px_var(--color-gold)]" : "bg-line"}`} />
            </div>
          </div>
          <div className="flex w-52 shrink-0 flex-col">
            <p className={`${HEADER} border-gold/50 bg-gold/10 text-gold`}>
              <CrownIcon size={13} />
              Campeón
            </p>
            <div className="flex flex-1 items-center">
              <div
                className={`flex w-full flex-col items-center gap-2 rounded-xl border-2 p-4 text-center ${
                  champion
                    ? "border-gold/70 bg-gradient-to-b from-gold/20 to-surface-1 shadow-[0_0_36px_-8px_var(--color-gold)]"
                    : "border-dashed border-line bg-surface-1/50"
                }`}
              >
                <TrophyIcon size={32} className={champion ? "text-gold" : "text-ink-faint"} />
                {champion ? (
                  <>
                    <TeamLogo name={champion.name} tag={champion.tag} path={champion.logo_path} size={48} className="rounded-lg" />
                    <span className="font-display text-base leading-tight">{champion.name}</span>
                  </>
                ) : (
                  <span className="text-xs text-ink-faint">Se define en la final</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
