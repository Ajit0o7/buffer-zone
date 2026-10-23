// Games two players can play together in the house. The server holds each room's game, so both players see the
// same thing, a reconnect picks it up again, and in the quiz neither can peek at the other's answer early.
//
//   hunt: ten golden hearts hidden around the house (chosen from HUNT.spots places the client knows); walk into one
//         to collect it. Found by either of you, counted for whoever found it; timed until the last one.
//   quiz: "How well do you know me?". Each round one of you (`about`) answers a question about themselves and the
//         other guesses; both picks are revealed together. Turns alternate; matches are counted.

// Keep these equal to the client's lists: HUNT_SPOTS in client/src/games/hunt.js, QUESTIONS in games/quiz.js.
export const HUNT = { spots: 24, hearts: 10 };
export const QUIZ = { questions: 32, rounds: 8, choices: 4 };
export const GAME_KINDS = new Set(['hunt', 'quiz']);

/** `count` distinct numbers below `n`, in random order. */
function pick(n, count, rand) {
  const all = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, count);
}

export function startGame(kind, now = Date.now(), rand = Math.random) {
  if (kind === 'hunt') return { kind, spots: pick(HUNT.spots, HUNT.hearts, rand), found: {}, startedAt: now, finishedAt: null };
  if (kind === 'quiz') {
    return {
      kind,
      order: pick(QUIZ.questions, QUIZ.rounds, rand),
      round: 0,
      about: rand() < 0.5 ? 'host' : 'guest',
      answer: null,
      guess: null,
      reveal: null,
      score: { matches: 0, rounds: 0 },
      done: false,
    };
  }
  return null;
}

/** A heart was walked into. Returns true if that changed anything. */
export function huntCollect(game, role, spot, now = Date.now()) {
  if (game?.kind !== 'hunt' || game.finishedAt !== null) return false;
  if (!game.spots.includes(spot) || game.found[spot]) return false;
  game.found[spot] = role;
  if (Object.keys(game.found).length === game.spots.length) game.finishedAt = now;
  return true;
}

/** A pick in the quiz: the answer if this round is about `role`, otherwise the guess. */
export function quizAnswer(game, role, choice) {
  if (game?.kind !== 'quiz' || game.done || game.reveal) return false;
  if (role === game.about) {
    if (game.answer !== null) return false;
    game.answer = choice;
  } else {
    if (game.guess !== null) return false;
    game.guess = choice;
  }
  if (game.answer !== null && game.guess !== null) {
    const match = game.answer === game.guess;
    game.reveal = { answer: game.answer, guess: game.guess, match };
    game.score.rounds += 1;
    if (match) game.score.matches += 1;
  }
  return true;
}

/** On to the next question (after a reveal); the turn passes to the other player. */
export function quizNext(game) {
  if (game?.kind !== 'quiz' || !game.reveal) return false;
  game.round += 1;
  game.reveal = null;
  game.answer = null;
  game.guess = null;
  if (game.round >= game.order.length) game.done = true;
  else game.about = game.about === 'host' ? 'guest' : 'host';
  return true;
}

/** What `role` may see of the game. In the quiz the partner's pick stays secret until both have chosen. */
export function viewFor(game, role, now = Date.now()) {
  if (!game) return null;
  if (game.kind === 'hunt') {
    return {
      kind: 'hunt',
      spots: game.spots,
      found: game.found,
      elapsedMs: (game.finishedAt ?? now) - game.startedAt,
      finished: game.finishedAt !== null,
    };
  }
  const mine = role === game.about ? game.answer : game.guess;
  const theirs = role === game.about ? game.guess : game.answer;
  return {
    kind: 'quiz',
    question: game.done ? null : game.order[game.round],
    round: game.round,
    rounds: game.order.length,
    about: game.about,
    myPick: mine,
    partnerPicked: theirs !== null,
    reveal: game.reveal,
    score: game.score,
    done: game.done,
  };
}
