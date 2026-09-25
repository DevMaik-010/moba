/**
 * Motor de cuadro de eliminación simple.
 *
 * Son funciones puras: no tocan Supabase. Las RPC de `supabase/migrations/0002_rpc.sql`
 * implementan exactamente el mismo algoritmo del lado del servidor (que es la
 * fuente de verdad); esta versión existe para la UI y para poder probar la
 * lógica sin base de datos.
 */

import type { MatchSide } from "@/lib/db/types";

export interface BracketSlot {
  round: number;
  slot: number;
  nextRound: number | null;
  nextSlot: number | null;
  nextSide: MatchSide | null;
}

/** Cuántas rondas tiene un cuadro de N cupos. 8 → 3 (cuartos, semis, final). */
export function roundsFor(bracketSize: number): number {
  return Math.log2(bracketSize);
}

/** Cuántos partidos tiene una ronda. Cuadro de 8, ronda 1 → 4 partidos. */
export function matchesInRound(bracketSize: number, round: number): number {
  return bracketSize / 2 ** round;
}

/**
 * El cuadro completo vacío, con cada partido ya enlazado al de la ronda
 * siguiente. Se genera al abrir las inscripciones, así los cuadritos están
 * dibujados antes de que se inscriba nadie.
 */
export function generateEmptyBracket(bracketSize: number): BracketSlot[] {
  if (!Number.isInteger(roundsFor(bracketSize)) || bracketSize < 2) {
    throw new Error(`bracketSize debe ser potencia de 2 y >= 2, recibido ${bracketSize}`);
  }

  const total = roundsFor(bracketSize);
  const slots: BracketSlot[] = [];

  for (let round = 1; round <= total; round++) {
    for (let slot = 1; slot <= matchesInRound(bracketSize, round); slot++) {
      const isFinal = round === total;
      slots.push({
        round,
        slot,
        nextRound: isFinal ? null : round + 1,
        nextSlot: isFinal ? null : Math.ceil(slot / 2),
        nextSide: isFinal ? null : slot % 2 === 1 ? "a" : "b",
      });
    }
  }

  return slots;
}

/**
 * Dónde cae el equipo que se inscribe en la posición `seed`.
 * Los equipos 1 y 2 al partido 1, el 3 y 4 al partido 2… De dos en dos, en
 * orden de inscripción.
 */
export function seedPosition(seed: number): { round: 1; slot: number; side: MatchSide } {
  if (seed < 1) throw new Error(`seed debe ser >= 1, recibido ${seed}`);
  return {
    round: 1,
    slot: Math.ceil(seed / 2),
    side: seed % 2 === 1 ? "a" : "b",
  };
}

/** El cuadro más chico que entra a N equipos. 5 equipos → cuadro de 8. */
export function suggestBracketSize(teamCount: number): number {
  return 2 ** Math.max(1, Math.ceil(Math.log2(Math.max(teamCount, 2))));
}

/** "Final", "Semifinal", "Cuartos de final", "Octavos"… */
export function roundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  switch (fromEnd) {
    case 0:
      return "Final";
    case 1:
      return "Semifinal";
    case 2:
      return "Cuartos de final";
    case 3:
      return "Octavos de final";
    default:
      return `Ronda de ${2 ** (fromEnd + 1)}`;
  }
}

// ---------------------------------------------------------------------------
// Simulación (espejo de las RPC, usada en tests)
// ---------------------------------------------------------------------------

export interface SimMatch {
  round: number;
  slot: number;
  teamA: string | null;
  teamB: string | null;
  winner: string | null;
  status: "pending" | "ready" | "done" | "bye";
}

/** Un cuadro vacío listo para simular. */
export function emptySimBracket(bracketSize: number): SimMatch[] {
  return generateEmptyBracket(bracketSize).map(({ round, slot }) => ({
    round,
    slot,
    teamA: null,
    teamB: null,
    winner: null,
    status: "pending" as const,
  }));
}

function findMatch(matches: SimMatch[], round: number, slot: number): SimMatch | undefined {
  return matches.find((m) => m.round === round && m.slot === slot);
}

/** Coloca a un equipo en el cuadro según su orden de inscripción. */
export function placeTeam(matches: SimMatch[], seed: number, teamId: string): SimMatch[] {
  const { slot, side } = seedPosition(seed);
  return matches.map((m) => {
    if (m.round !== 1 || m.slot !== slot) return m;
    const next = { ...m, [side === "a" ? "teamA" : "teamB"]: teamId };
    if (next.teamA && next.teamB) next.status = "ready";
    return next;
  });
}

/** Empuja al ganador al partido siguiente. */
export function advanceWinner(
  matches: SimMatch[],
  round: number,
  slot: number,
  winner: string,
  status: "done" | "bye" = "done",
): SimMatch[] {
  const total = Math.max(...matches.map((m) => m.round));
  const nextRound = round === total ? null : round + 1;
  const nextSlot = Math.ceil(slot / 2);
  const nextSide: MatchSide = slot % 2 === 1 ? "a" : "b";

  return matches.map((m) => {
    if (m.round === round && m.slot === slot) {
      return { ...m, winner, status };
    }
    if (nextRound !== null && m.round === nextRound && m.slot === nextSlot) {
      const next = { ...m, [nextSide === "a" ? "teamA" : "teamB"]: winner };
      if (next.teamA && next.teamB) next.status = "ready";
      return next;
    }
    return m;
  });
}

function slotsOf(matches: SimMatch[], round: number): number[] {
  return matches
    .filter((m) => m.round === round)
    .map((m) => m.slot)
    .sort((a, b) => a - b);
}

/** Rama muerta: un bye sin ganador, o sea un trozo del cuadro que nadie ocupó. */
function isDeadBranch(matches: SimMatch[], round: number, slot: number): boolean {
  const m = findMatch(matches, round, slot);
  return !!m && m.status === "bye" && m.winner === null;
}

function markDeadBranch(matches: SimMatch[], round: number, slot: number): SimMatch[] {
  return matches.map((m) =>
    m.round === round && m.slot === slot ? { ...m, status: "bye" as const } : m,
  );
}

/**
 * Cierra el cuadro y resuelve los pases directos.
 *
 * En la ronda 1 basta con mirar quién se inscribió. De la ronda 2 en adelante,
 * un hueco vacío NO es un bye: casi todos lo están mientras la ronda previa no
 * se juegue. Solo cuenta como definitivo si el partido que lo alimenta es una
 * rama muerta, y así un bye puede encadenar otro sin adjudicar partidos que
 * todavía se van a disputar.
 */
export function resolveByes(matches: SimMatch[]): SimMatch[] {
  let result = matches;
  const total = Math.max(...matches.map((m) => m.round));

  for (const slot of slotsOf(result, 1)) {
    const m = findMatch(result, 1, slot);
    if (!m || m.status !== "pending") continue;

    if (m.teamA === null && m.teamB === null) {
      result = markDeadBranch(result, 1, slot);
    } else if (m.teamA === null || m.teamB === null) {
      result = advanceWinner(result, 1, slot, (m.teamA ?? m.teamB)!, "bye");
    }
  }

  for (let round = 2; round <= total; round++) {
    for (const slot of slotsOf(result, round)) {
      const m = findMatch(result, round, slot);
      if (!m || m.status !== "pending") continue;

      const aDead = isDeadBranch(result, round - 1, slot * 2 - 1);
      const bDead = isDeadBranch(result, round - 1, slot * 2);

      if (aDead && bDead) {
        result = markDeadBranch(result, round, slot);
      } else if (aDead && m.teamB !== null) {
        result = advanceWinner(result, round, slot, m.teamB, "bye");
      } else if (bDead && m.teamA !== null) {
        result = advanceWinner(result, round, slot, m.teamA, "bye");
      }
    }
  }

  return result;
}
