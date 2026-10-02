import Link from "next/link";

import { SeriesPips } from "@/components/bracket/series-pips";
import { TeamLogo } from "@/components/ui/team-logo";
import { winsNeeded } from "@/lib/bracket/bracket";
import type { Match, Team } from "@/lib/db/types";

interface Props {
  match: Match;
  teams: Map<string, Team>;
  /** Partidas de la serie: 3, o 5 en la final. */
  bestOf: number;
  highlightTeamId?: string | null;
  /** Si viene, el cuadrito abre la sala del enfrentamiento. */
  href?: string;
}

interface SideProps {
  team: Team | undefined;
  score: number;
  needed: number;
  isWinner: boolean;
  isLoser: boolean;
  /** Va arriba en la serie que se está jugando. */
  isLeading: boolean;
  highlighted: boolean;
  showScore: boolean;
  /** Este equipo crea la sala en MLBB. */
  isHost: boolean;
}

function Side({
  team,
  score,
  needed,
  isWinner,
  isLoser,
  isLeading,
  highlighted,
  showScore,
  isHost,
}: SideProps) {
  return (
    <div
      className={[
        "flex items-center gap-2 px-3 py-2 text-sm",
        isWinner || isLeading ? "font-semibold text-ink" : "",
        isLoser ? "text-ink-faint line-through decoration-ink-faint/60" : "",
        !team ? "text-ink-faint italic" : "",
        highlighted ? "bg-brand/10" : "",
      ].join(" ")}
    >
      <span className="w-5 shrink-0 font-mono text-[11px] text-ink-faint">
        {team?.seed ?? "—"}
      </span>
      <TeamLogo name={team?.name} tag={team?.tag} path={team?.logo_path} size={22} />
      <span className="min-w-0 flex-1 truncate">{team?.name ?? "Por definir"}</span>
      {isHost ? (
        <span
          className="shrink-0 rounded border border-brand/40 px-1 text-[10px] font-semibold uppercase text-brand"
          title="Este equipo crea la sala"
        >
          Sala
        </span>
      ) : null}
      {showScore ? (
        <>
          <SeriesPips wins={score} needed={needed} leading={isWinner || isLeading} />
          <span className="w-3 shrink-0 text-right font-mono text-xs tabular-nums">{score}</span>
        </>
      ) : null}
    </div>
  );
}

export function MatchCard({ match, teams, bestOf, highlightTeamId, href }: Props) {
  const teamA = match.team_a_id ? teams.get(match.team_a_id) : undefined;
  const teamB = match.team_b_id ? teams.get(match.team_b_id) : undefined;
  const decided = match.status === "done";
  const live = match.status === "live";
  const showScore = decided || live;
  const needed = winsNeeded(bestOf);

  const empty = !teamA && !teamB;
  const isBye = match.status === "bye";
  const showHost = match.status === "ready" || live;

  const body = (
    <>
      <Side
        team={teamA}
        score={match.score_a}
        needed={needed}
        isWinner={decided && match.winner_id === match.team_a_id}
        isLoser={decided && match.winner_id !== match.team_a_id}
        isLeading={live && match.score_a > match.score_b}
        highlighted={!!highlightTeamId && match.team_a_id === highlightTeamId}
        showScore={showScore}
        isHost={showHost && match.host_side === "a"}
      />
      <div className="h-px bg-line" />
      <Side
        team={teamB}
        score={match.score_b}
        needed={needed}
        isWinner={decided && match.winner_id === match.team_b_id}
        isLoser={decided && match.winner_id !== match.team_b_id}
        isLeading={live && match.score_b > match.score_a}
        highlighted={!!highlightTeamId && match.team_b_id === highlightTeamId}
        showScore={showScore}
        isHost={showHost && match.host_side === "b"}
      />

      {isBye ? (
        <p className="border-t border-line bg-surface-2 px-3 py-1 text-[11px] text-ink-faint">
          {match.winner_id ? "Pase directo" : "Sin equipos"}
        </p>
      ) : live ? (
        <p className="flex items-center gap-1.5 border-t border-line bg-surface-2 px-3 py-1 text-[11px] text-warn">
          <span className="size-1.5 animate-pulse rounded-full bg-warn" aria-hidden />
          En juego · partida {Math.min(match.score_a + match.score_b + 1, bestOf)} de {bestOf}
        </p>
      ) : null}
    </>
  );

  const className = [
    "block w-full overflow-hidden rounded-lg border bg-surface-1 transition",
    empty ? "border-dashed border-line/60" : "border-line",
    match.status === "ready" || live ? "border-brand/50" : "",
    isBye ? "opacity-60" : "",
    href ? "hover:border-brand focus-visible:outline-2 focus-visible:outline-brand" : "",
  ].join(" ");

  // Solo se entra a la sala de un partido con sus dos equipos definidos.
  const clickable =
    href && teamA && teamB && (match.status === "ready" || live || decided);

  return clickable ? (
    <Link
      href={href}
      className={className}
      aria-label={`Abrir el enfrentamiento ${teamA.name} contra ${teamB.name}`}
    >
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
