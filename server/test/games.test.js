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

import { TOD, todAdd, todDone, todPick, todReroll, todWild } from '../src/games.js';
import { sanitizeCardText } from '../src/validate.js';

test('truth or dare: only the active player picks and re-rolls; Done passes the turn and celebrates', () => {
  const g = startGame('tod', 0, seq([0.3]));
  const me = g.turn;
  const you = me === 'host' ? 'guest' : 'host';
  assert.equal(todPick(g, you, 'truth'), false); // not their turn
  assert.equal(todPick(g, me, 'poem'), false);
  assert.equal(todPick(g, me, 'dare', seq([0.9, 0.42])), true); // no secret cards, no wildcard (0.9): generated
  assert.equal(g.phase, 'card');
  assert.equal(g.card.source, 'deck');
  const seed = g.card.seed;
  assert.equal(todReroll(g, you), false);
  assert.equal(todReroll(g, me, seq([0.9, 0.77])), true);
  assert.notEqual(g.card.seed, seed);
  assert.equal(g.card.type, 'dare');
  assert.equal(todDone(g), true);
  assert.equal(g.turn, you);
  assert.equal(g.celebrate, 1);
  assert.equal(g.phase, 'choose');
});

test('truth or dare: wildcards are written by the partner; secret cards stay secret until drawn', () => {
  const g = startGame('tod', 0, seq([0.3]));
  const me = g.turn;
  const you = me === 'host' ? 'guest' : 'host';
  todPick(g, me, 'truth', seq([0.01])); // wildcard
  assert.equal(g.phase, 'wild');
  assert.equal(todWild(g, me, 'Pick your own'), false); // the player can't write their own wildcard
  assert.equal(todWild(g, you, 'What did you dream about last night?'), true);
  assert.equal(g.card.text, 'What did you dream about last night?');
  todDone(g); // now it's `you`'s turn; `me` writes a secret dare for them
  assert.equal(todAdd(g, me, 'dare', 'Send me a photo of your shoes'), true);
  const view = viewFor(g, you);
  assert.equal(view.partnerCards, 1);
  assert.equal(JSON.stringify(view).includes('shoes'), false);
  todPick(g, you, 'dare', seq([0.1, 0])); // draws the secret card
  assert.equal(g.card.source, 'custom');
  assert.equal(g.card.text, 'Send me a photo of your shoes');
  assert.equal(viewFor(g, you).partnerCards, 0);
  for (let i = 0; i < TOD.maxCustom; i++) todAdd(g, me, 'truth', `q${i}`);
  assert.equal(todAdd(g, me, 'truth', 'one too many'), false);
});

test('card text: plain, one line, trimmed, at most 200 characters', () => {
  assert.equal(sanitizeCardText('  Sing\nto me \u0007 now '), 'Sing to me now');
  assert.equal(sanitizeCardText('   '), null);
  assert.equal(sanitizeCardText(42), null);
  assert.equal(sanitizeCardText('x'.repeat(300)).length, 200);
});
