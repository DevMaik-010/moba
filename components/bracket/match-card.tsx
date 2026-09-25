import type { Match, Team } from "@/lib/db/types";

interface Props {
  match: Match;
  teams: Map<string, Team>;
  highlightTeamId?: string | null;
}

interface SideProps {
  team: Team | undefined;
  score: number;
  isWinner: boolean;
  isLoser: boolean;
  highlighted: boolean;
  showScore: boolean;
}

function Side({ team, score, isWinner, isLoser, highlighted, showScore }: SideProps) {
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
      <span className="min-w-0 flex-1 truncate">{team?.name ?? "Por definir"}</span>
      {showScore ? (
        <span className="shrink-0 font-mono text-xs tabular-nums">{score}</span>
      ) : null}
    </div>
  );
}

export function MatchCard({ match, teams, highlightTeamId }: Props) {
  const teamA = match.team_a_id ? teams.get(match.team_a_id) : undefined;
  const teamB = match.team_b_id ? teams.get(match.team_b_id) : undefined;
  const decided = match.status === "done";
  const showScore = decided || match.status === "live";

  const empty = !teamA && !teamB;
  const isBye = match.status === "bye";

  return (
    <div
      className={[
        "w-full overflow-hidden rounded-lg border bg-surface-1 transition",
        empty ? "border-dashed border-line/60" : "border-line",
        match.status === "ready" ? "border-brand/50" : "",
        isBye ? "opacity-60" : "",
      ].join(" ")}
    >
      <Side
        team={teamA}
        score={match.score_a}
        isWinner={decided && match.winner_id === match.team_a_id}
        isLoser={decided && match.winner_id !== match.team_a_id}
        highlighted={!!highlightTeamId && match.team_a_id === highlightTeamId}
        showScore={showScore}
      />
      <div className="h-px bg-line" />
      <Side
        team={teamB}
        score={match.score_b}
        isWinner={decided && match.winner_id === match.team_b_id}
        isLoser={decided && match.winner_id !== match.team_b_id}
        highlighted={!!highlightTeamId && match.team_b_id === highlightTeamId}
        showScore={showScore}
      />

      {isBye ? (
        <p className="border-t border-line bg-surface-2 px-3 py-1 text-[11px] text-ink-faint">
          {match.winner_id ? "Pase directo" : "Sin equipos"}
        </p>
      ) : null}
    </div>
  );
}
