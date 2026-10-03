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
        "relative flex items-center gap-2 py-2 pr-2 pl-3 text-sm",
        isWinner ? "bg-gradient-to-r from-win/15 to-transparent font-semibold text-ink" : "",
        isLeading ? "font-semibold text-ink" : "",
        isLoser ? "text-ink-faint" : "",
        !team ? "text-ink-faint italic" : "",
        highlighted ? "bg-brand/15" : "",
      ].join(" ")}
    >
      {highlighted ? <span className="absolute inset-y-0 left-0 w-0.5 bg-brand" aria-hidden /> : null}
      <span className="w-5 shrink-0 font-mono text-[11px] text-ink-faint tabular-nums">
        {team?.seed ?? "—"}
      </span>
      <TeamLogo
        name={team?.name}
        tag={team?.tag}
        path={team?.logo_path}
        size={24}
        className={isLoser ? "opacity-50 grayscale" : ""}
      />
      <span className={`min-w-0 flex-1 truncate ${isLoser ? "line-through decoration-ink-faint/50" : ""}`}>
        {team?.name ?? "Por definir"}
      </span>
      {isHost ? (
        <span
          className="shrink-0 rounded border border-accent/50 bg-accent/10 px-1 text-[10px] font-bold uppercase tracking-wide text-accent"
          title="Este equipo crea la sala de la partida actual"
        >
          Sala
        </span>
      ) : null}
      {showScore ? (
        <>
          <SeriesPips wins={score} needed={needed} leading={isWinner || isLeading} />
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded font-display text-sm tabular-nums ${
              isWinner ? "bg-win text-surface-0" : isLeading ? "bg-surface-3 text-ink" : "bg-surface-2 text-ink-faint"
            }`}
          >
            {score}
          </span>
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
  const ready = match.status === "ready";
  const showScore = decided || live;
  const needed = winsNeeded(bestOf);

  const empty = !teamA && !teamB;
  const isBye = match.status === "bye";
  const showHost = ready || live;

  // Barra de estado a la izquierda: se lee el estado sin abrir el partido.
  const stripe = live ? "bg-warn" : ready ? "bg-brand" : decided ? "bg-win/70" : "bg-line";

  const body = (
    <>
      <span className={`absolute inset-y-0 left-0 w-1 ${stripe}`} aria-hidden />
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
      <div className="relative h-px bg-line">
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-line bg-surface-1 px-1 font-display text-[9px] leading-3 text-ink-faint">
          VS
        </span>
      </div>
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
        <p className="border-t border-line bg-surface-2/70 px-3 py-1 text-[11px] text-ink-faint">
          {match.winner_id ? "Pase directo" : "Sin equipos"}
        </p>
      ) : live ? (
        <p className="flex items-center gap-1.5 border-t border-warn/30 bg-warn/10 px-3 py-1 text-[11px] font-semibold text-warn">
          <span className="relative flex size-2" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-warn opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-warn" />
          </span>
          EN VIVO · partida {Math.min(match.score_a + match.score_b + 1, bestOf)} de {bestOf}
        </p>
      ) : ready ? (
        <p className="border-t border-brand/30 bg-brand/10 px-3 py-1 text-[11px] font-semibold text-brand">
          Listo para jugar
        </p>
      ) : null}
    </>
  );

  const className = [
    "relative block w-full overflow-hidden rounded-lg border bg-surface-1/95 shadow-[0_8px_24px_-16px_black] transition duration-200",
    empty ? "border-dashed border-line/70 bg-surface-1/50" : "border-line",
    ready ? "border-brand/50" : "",
    live ? "animate-neon border-warn/60" : "",
    isBye ? "opacity-60" : "",
    href
      ? "hover:-translate-y-0.5 hover:border-brand hover:shadow-[0_10px_28px_-12px_var(--color-brand)]"
      : "",
  ].join(" ");

  // Solo se entra a la sala de un partido con sus dos equipos definidos.
  const clickable = href && teamA && teamB && (ready || live || decided);

  return clickable ? (
    <Link
      href={href}
      className={`${className} cursor-pointer`}
      aria-label={`Abrir el enfrentamiento ${teamA.name} contra ${teamB.name}`}
    >
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
