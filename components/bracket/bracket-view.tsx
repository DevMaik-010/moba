"use client";

import { useEffect, useMemo, useState } from "react";

import { MatchCard } from "@/components/bracket/match-card";
import { roundLabel } from "@/lib/bracket/bracket";
import { createClient } from "@/lib/supabase/client";
import type { Match, Team } from "@/lib/db/types";

interface Props {
  tournamentId: string;
  initialMatches: Match[];
  initialTeams: Team[];
  /** Resalta al equipo del usuario dentro del cuadro. */
  highlightTeamId?: string | null;
}

/**
 * El "]" que une dos partidos con el de la ronda siguiente.
 * Cada par ocupa un `flex-1`, igual que dos filas de partido, así que la mitad
 * central del conector cae exactamente sobre el centro de cada cuadrito.
 */
function Connector({ pairs }: { pairs: number }) {
  return (
    <div className="flex w-8 shrink-0 flex-1 flex-col" aria-hidden>
      {Array.from({ length: pairs }, (_, i) => (
        <div key={i} className="flex flex-1 items-center">
          <div className="relative h-1/2 w-1/2 rounded-r-md border-y border-r border-line">
            <span className="absolute left-full top-1/2 h-px w-4 bg-line" />
          </div>
        </div>
      ))}
    </div>
  );
}

const HEADER = "mb-2 h-4 text-center text-[11px] font-semibold uppercase tracking-wider";

export function BracketView({
  tournamentId,
  initialMatches,
  initialTeams,
  highlightTeamId,
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

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2">
      <div className="flex min-h-[420px] min-w-max items-stretch">
        {rounds.map(({ round, matches: roundMatches }, index) => (
          <div key={round} className="flex items-stretch">
            <div className="flex w-56 shrink-0 flex-col">
              <p className={`${HEADER} text-ink-faint`}>{roundLabel(round, total)}</p>
              <div className="flex flex-1 flex-col">
                {roundMatches.map((match) => (
                  <div key={match.id} className="flex flex-1 items-center py-1">
                    <MatchCard
                      match={match}
                      teams={teamsById}
                      highlightTeamId={highlightTeamId}
                    />
                  </div>
                ))}
              </div>
            </div>

            {index < rounds.length - 1 ? (
              <div className="flex flex-col">
                <p className={HEADER} aria-hidden />
                <Connector pairs={Math.ceil(roundMatches.length / 2)} />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
