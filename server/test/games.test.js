import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUNT, QUIZ, huntCollect, quizAnswer, quizNext, startGame, viewFor } from '../src/games.js';
import { sanitizeGameStart, sanitizeIndex } from '../src/validate.js';
import { GAME_KINDS } from '../src/games.js';

const seq = (values) => { let i = 0; return () => values[i++ % values.length]; };

test('hunt: distinct hearts, collected once each, timed to the last', () => {
  const g = startGame('hunt', 1000, seq([0.1, 0.9, 0.5, 0.3, 0.7]));
  assert.equal(g.spots.length, HUNT.hearts);
  assert.equal(new Set(g.spots).size, HUNT.hearts);
  assert.ok(g.spots.every((s) => s >= 0 && s < HUNT.spots));
  const notInGame = [...Array(HUNT.spots).keys()].find((s) => !g.spots.includes(s));
  assert.equal(huntCollect(g, 'host', notInGame, 2000), false);
  assert.equal(huntCollect(g, 'host', g.spots[0], 2000), true);
  assert.equal(huntCollect(g, 'guest', g.spots[0], 2000), false); // already found
  g.spots.slice(1).forEach((s, i) => huntCollect(g, i % 2 ? 'host' : 'guest', s, 5000));
  const v = viewFor(g, 'host', 9000);
  assert.equal(v.finished, true);
  assert.equal(v.elapsedMs, 4000);
  assert.equal(Object.values(v.found).filter((r) => r === 'host').length + Object.values(v.found).filter((r) => r === 'guest').length, HUNT.hearts);
  assert.equal(huntCollect(g, 'host', g.spots[1], 9000), false);
});

test('quiz: picks stay hidden until both have chosen, then turns alternate', () => {
  const g = startGame('quiz', 0, seq([0.2, 0.6, 0.4, 0.8, 0.1]));
  assert.equal(g.order.length, QUIZ.rounds);
  const about = g.about;
  const other = about === 'host' ? 'guest' : 'host';
  assert.equal(quizAnswer(g, about, 2), true);
  assert.equal(quizAnswer(g, about, 1), false); // no changing your answer
  const peek = viewFor(g, other);
  assert.equal(peek.partnerPicked, true);
  assert.equal(peek.reveal, null); // the guesser can't see the answer yet
  assert.equal(JSON.stringify(peek).includes('"answer"'), false);
  assert.equal(quizNext(g), false); // can't skip before the reveal
  assert.equal(quizAnswer(g, other, 2), true);
  assert.deepEqual(viewFor(g, about).reveal, { answer: 2, guess: 2, match: true });
  assert.equal(quizNext(g), true);
  assert.equal(g.about, other);
  for (let r = 1; r < QUIZ.rounds; r++) {
    quizAnswer(g, g.about, 0);
    quizAnswer(g, g.about === 'host' ? 'guest' : 'host', r % 2);
    quizNext(g);
  }
  const end = viewFor(g, 'host');
  assert.equal(end.done, true);
  assert.equal(end.question, null);
  assert.equal(end.score.rounds, QUIZ.rounds);
});

test('games: only known kinds and in-range indices get through', () => {
  assert.deepEqual(sanitizeGameStart({ kind: 'hunt' }, GAME_KINDS), { kind: 'hunt' });
  assert.equal(sanitizeGameStart({ kind: 'poker' }, GAME_KINDS), null);
  assert.equal(sanitizeIndex(3, 4), 3);
  for (const bad of [4, -1, 1.5, '2', null, undefined]) assert.equal(sanitizeIndex(bad, 4), null);
});
