import Link from "next/link";

import { TeamLogo } from "@/components/ui/team-logo";
import type { Match, Team } from "@/lib/db/types";

interface Props {
  match: Match;
  teams: Map<string, Team>;
  highlightTeamId?: string | null;
  /** Si viene, el cuadrito abre la sala del enfrentamiento. */
  href?: string;
}

interface SideProps {
  team: Team | undefined;
  score: number;
  isWinner: boolean;
  isLoser: boolean;
  highlighted: boolean;
  showScore: boolean;
  /** Este equipo crea la sala en MLBB. */
  isHost: boolean;
}

function Side({ team, score, isWinner, isLoser, highlighted, showScore, isHost }: SideProps) {
  return (
    <div
      className={[
        "flex items-center gap-2 px-3 py-2 text-sm",
        isWinner ? "font-semibold text-ink" : "",
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
        <span className="shrink-0 font-mono text-xs tabular-nums">{score}</span>
      ) : null}
    </div>
  );
}

export function MatchCard({ match, teams, highlightTeamId, href }: Props) {
  const teamA = match.team_a_id ? teams.get(match.team_a_id) : undefined;
  const teamB = match.team_b_id ? teams.get(match.team_b_id) : undefined;
  const decided = match.status === "done";
  const showScore = decided || match.status === "live";

  const empty = !teamA && !teamB;
  const isBye = match.status === "bye";
  const showHost = match.status === "ready" || match.status === "live";

  const body = (
    <>
      <Side
        team={teamA}
        score={match.score_a}
        isWinner={decided && match.winner_id === match.team_a_id}
        isLoser={decided && match.winner_id !== match.team_a_id}
        highlighted={!!highlightTeamId && match.team_a_id === highlightTeamId}
        showScore={showScore}
        isHost={showHost && match.host_side === "a"}
      />
      <div className="h-px bg-line" />
      <Side
        team={teamB}
        score={match.score_b}
        isWinner={decided && match.winner_id === match.team_b_id}
        isLoser={decided && match.winner_id !== match.team_b_id}
        highlighted={!!highlightTeamId && match.team_b_id === highlightTeamId}
        showScore={showScore}
        isHost={showHost && match.host_side === "b"}
      />

      {isBye ? (
        <p className="border-t border-line bg-surface-2 px-3 py-1 text-[11px] text-ink-faint">
          {match.winner_id ? "Pase directo" : "Sin equipos"}
        </p>
      ) : null}
    </>
  );

  const className = [
    "block w-full overflow-hidden rounded-lg border bg-surface-1 transition",
    empty ? "border-dashed border-line/60" : "border-line",
    match.status === "ready" || match.status === "live" ? "border-brand/50" : "",
    isBye ? "opacity-60" : "",
    href ? "hover:border-brand focus-visible:outline-2 focus-visible:outline-brand" : "",
  ].join(" ");

  // Solo se entra a la sala de un partido con sus dos equipos definidos.
  const clickable =
    href && teamA && teamB && (match.status === "ready" || match.status === "live" || match.status === "done");

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
