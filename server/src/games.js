// Games two players can play together in the house. The server holds each room's game, so both players see the
// same thing, a reconnect picks it up again, and in the quiz neither can peek at the other's answer early.
//
//   hunt: ten golden hearts hidden around the house (chosen from HUNT.spots places the client knows); walk into one
//         to collect it. Found by either of you, counted for whoever found it; timed until the last one.
//   quiz: "How well do you know me?". Each round one of you (`about`) answers a question about themselves and the
//         other guesses; both picks are revealed together. Turns alternate; matches are counted.
//   tod:  Truth or Dare. Whoever's turn it is picks truth or dare; a card is drawn for both to see: usually from the
//         endless generator (the server sends a seed, both clients expand it the same way), sometimes one of the
//         secret cards the partner wrote, sometimes a wildcard the partner writes there and then. Re-roll for another
//         card; Done passes the turn (and sets off confetti on both screens).

// Keep these equal to the client's lists: HUNT_SPOTS in client/src/games/hunt.js, QUESTIONS in games/quiz.js.
export const HUNT = { spots: 24, hearts: 10 };
export const QUIZ = { questions: 32, rounds: 8, choices: 4 };
export const TOD = { maxCustom: 40, customChance: 0.4, wildChance: 0.12, types: new Set(['truth', 'dare']) };
export const GAME_KINDS = new Set(['hunt', 'quiz', 'tod']);

const other = (role) => (role === 'host' ? 'guest' : 'host');

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
  if (kind === 'tod') {
    return { kind, turn: rand() < 0.5 ? 'host' : 'guest', phase: 'choose', card: null, round: 1, celebrate: 0, decks: { host: [], guest: [] } };
  }
  return null;
}

/** Draws a card of `type` for whoever's turn it is: a secret card the partner wrote, a wildcard, or a generated one. */
function drawCard(game, type, rand) {
  const author = other(game.turn); // secret cards are written by the partner, for the player
  const mine = game.decks[author].filter((c) => c.type === type);
  if (mine.length && rand() < TOD.customChance) {
    const card = mine[Math.floor(rand() * mine.length)];
    game.decks[author].splice(game.decks[author].indexOf(card), 1);
    game.card = { type, source: 'custom', text: card.text };
    game.phase = 'card';
  } else if (rand() < TOD.wildChance) {
    game.card = { type, source: 'wild', text: null }; // the partner writes it now
    game.phase = 'wild';
  } else {
    game.card = { type, source: 'deck', seed: Math.floor(rand() * 2 ** 31) };
    game.phase = 'card';
  }
}

/** Truth or dare? Only the player whose turn it is picks. */
export function todPick(game, role, type, rand = Math.random) {
  if (game?.kind !== 'tod' || game.phase !== 'choose' || role !== game.turn || !TOD.types.has(type)) return false;
  drawCard(game, type, rand);
  return true;
}

/** Another card of the same kind, for the player whose turn it is. */
export function todReroll(game, role, rand = Math.random) {
  if (game?.kind !== 'tod' || game.phase !== 'card' || role !== game.turn) return false;
  drawCard(game, game.card.type, rand);
  return true;
}

/** The partner writes the wildcard's truth or dare. */
export function todWild(game, role, text) {
  if (game?.kind !== 'tod' || game.phase !== 'wild' || role === game.turn) return false;
  game.card = { ...game.card, text };
  game.phase = 'card';
  return true;
}

/** The card's done: confetti for both, and the turn passes. Either player can say so. */
export function todDone(game) {
  if (game?.kind !== 'tod' || game.phase !== 'card') return false;
  game.celebrate += 1;
  game.turn = other(game.turn);
  game.phase = 'choose';
  game.card = null;
  game.round += 1;
  return true;
}

/** A secret card for the partner's deck; its text stays hidden until it's drawn. */
export function todAdd(game, role, type, text) {
  if (game?.kind !== 'tod' || !TOD.types.has(type) || game.decks[role].length >= TOD.maxCustom) return false;
  game.decks[role].push({ type, text });
  return true;
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
  if (game.kind === 'tod') {
    return {
      kind: 'tod',
      turn: game.turn,
      phase: game.phase,
      card: game.card,
      round: game.round,
      celebrate: game.celebrate,
      myCards: game.decks[role].length, // how many secret cards I've written that are still waiting
      partnerCards: game.decks[other(role)].length, // and they have (counts only: the texts stay secret)
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
