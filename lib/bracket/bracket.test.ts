import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  advanceWinner,
  emptySimBracket,
  generateEmptyBracket,
  matchesInRound,
  placeTeam,
  resolveByes,
  roundLabel,
  roundsFor,
  seedPosition,
  suggestBracketSize,
  type SimMatch,
} from "./bracket.ts";

test("un cuadro de 8 tiene 3 rondas y 7 partidos", () => {
  const bracket = generateEmptyBracket(8);
  assert.equal(roundsFor(8), 3);
  assert.equal(bracket.length, 7);
  assert.equal(matchesInRound(8, 1), 4);
  assert.equal(matchesInRound(8, 3), 1);
});

test("cada partido apunta al de la ronda siguiente, impar por A y par por B", () => {
  const bracket = generateEmptyBracket(8);
  const r1s1 = bracket.find((m) => m.round === 1 && m.slot === 1)!;
  const r1s2 = bracket.find((m) => m.round === 1 && m.slot === 2)!;
  const final = bracket.find((m) => m.round === 3)!;

  assert.deepEqual([r1s1.nextRound, r1s1.nextSlot, r1s1.nextSide], [2, 1, "a"]);
  assert.deepEqual([r1s2.nextRound, r1s2.nextSlot, r1s2.nextSide], [2, 1, "b"]);
  assert.equal(final.nextRound, null, "la final no apunta a ningún partido");
});

test("rechaza cuadros que no son potencia de 2", () => {
  assert.throws(() => generateEmptyBracket(6));
  assert.throws(() => generateEmptyBracket(1));
});

test("los equipos se emparejan de dos en dos por orden de inscripción", () => {
  assert.deepEqual(seedPosition(1), { round: 1, slot: 1, side: "a" });
  assert.deepEqual(seedPosition(2), { round: 1, slot: 1, side: "b" });
  assert.deepEqual(seedPosition(3), { round: 1, slot: 2, side: "a" });
  assert.deepEqual(seedPosition(8), { round: 1, slot: 4, side: "b" });
});

test("el cuadro sugerido es el menor que entra a los equipos", () => {
  assert.equal(suggestBracketSize(2), 2);
  assert.equal(suggestBracketSize(5), 8);
  assert.equal(suggestBracketSize(8), 8);
  assert.equal(suggestBracketSize(9), 16);
});

test("las rondas se nombran desde la final hacia atrás", () => {
  assert.equal(roundLabel(3, 3), "Final");
  assert.equal(roundLabel(2, 3), "Semifinal");
  assert.equal(roundLabel(1, 3), "Cuartos de final");
  assert.equal(roundLabel(1, 5), "Ronda de 32");
});

test("un partido queda listo cuando llegan sus dos equipos", () => {
  let bracket = emptySimBracket(8);
  bracket = placeTeam(bracket, 1, "alfa");
  assert.equal(bracket.find((m) => m.round === 1 && m.slot === 1)!.status, "pending");

  bracket = placeTeam(bracket, 2, "beta");
  const m1 = bracket.find((m) => m.round === 1 && m.slot === 1)!;
  assert.equal(m1.teamA, "alfa");
  assert.equal(m1.teamB, "beta");
  assert.equal(m1.status, "ready");
});

test("el ganador sube a la ronda siguiente por el lado correcto", () => {
  let bracket = emptySimBracket(8);
  for (const [seed, id] of [[1, "a"], [2, "b"], [3, "c"], [4, "d"]] as const) {
    bracket = placeTeam(bracket, seed, id);
  }

  bracket = advanceWinner(bracket, 1, 1, "a");
  bracket = advanceWinner(bracket, 1, 2, "d");

  const semi = bracket.find((m) => m.round === 2 && m.slot === 1)!;
  assert.equal(semi.teamA, "a");
  assert.equal(semi.teamB, "d");
  assert.equal(semi.status, "ready");
});

test("5 equipos en un cuadro de 8: el quinto pasa por bye", () => {
  let bracket = emptySimBracket(8);
  for (const [seed, id] of [[1, "a"], [2, "b"], [3, "c"], [4, "d"], [5, "e"]] as const) {
    bracket = placeTeam(bracket, seed, id);
  }

  bracket = resolveByes(bracket);

  const byeMatch = bracket.find((m) => m.round === 1 && m.slot === 3)!;
  assert.equal(byeMatch.status, "bye");
  assert.equal(byeMatch.winner, "e");

  // El partido 4 nunca se llenó: rama muerta.
  const muerta = bracket.find((m) => m.round === 1 && m.slot === 4)!;
  assert.equal(muerta.status, "bye");
  assert.equal(muerta.winner, null);

  // "e" encadena un segundo bye porque su rival de semis sería la rama muerta.
  const semi2 = bracket.find((m) => m.round === 2 && m.slot === 2)!;
  assert.equal(semi2.teamA, "e");
  assert.equal(semi2.status, "bye");
  assert.equal(semi2.winner, "e");
  assert.equal(bracket.find((m) => m.round === 3 && m.slot === 1)!.teamB, "e");
});

test("un bye no adjudica partidos que todavía se van a jugar", () => {
  let bracket = emptySimBracket(8);
  for (const [seed, id] of [[1, "a"], [2, "b"], [3, "c"], [4, "d"], [5, "e"]] as const) {
    bracket = placeTeam(bracket, seed, id);
  }

  bracket = resolveByes(bracket);

  // La otra semifinal la alimentan dos partidos reales: debe seguir esperando.
  const semi1 = bracket.find((m) => m.round === 2 && m.slot === 1)!;
  assert.equal(semi1.status, "pending");
  assert.equal(semi1.winner, null);

  // Y la final tiene a "e" de un lado, pero sigue sin jugarse.
  const final = bracket.find((m) => m.round === 3 && m.slot === 1)!;
  assert.equal(final.status, "pending");
  assert.equal(final.winner, null);
  assert.equal(final.teamA, null);
});

test("3 equipos en un cuadro de 4: solo el tercero recibe bye", () => {
  let bracket = emptySimBracket(4);
  for (const [seed, id] of [[1, "a"], [2, "b"], [3, "c"]] as const) {
    bracket = placeTeam(bracket, seed, id);
  }

  bracket = resolveByes(bracket);

  const jugado = bracket.find((m) => m.round === 1 && m.slot === 1)!;
  assert.equal(jugado.status, "ready", "el partido con dos equipos no se toca");

  const conBye: SimMatch = bracket.find((m) => m.round === 1 && m.slot === 2)!;
  assert.equal(conBye.status, "bye");
  assert.equal(conBye.winner, "c");
  assert.equal(bracket.find((m) => m.round === 2 && m.slot === 1)!.teamB, "c");
});
