import { useGames } from '../state/games';

// The wire side of the games: the server holds the state and sends each player their own view of it.

let io = null; // set by bindGameSocket (this file can't import socket.js, which imports it)

export const startGame = (kind) => io?.emit('game:start', { kind });
export const endGame = () => io?.emit('game:end');
export const collectHeart = (spot) => io?.emit('game:hunt-collect', { spot });
export const answerQuiz = (choice) => io?.emit('game:quiz-answer', { choice });
export const nextQuestion = () => io?.emit('game:quiz-next');

export function bindGameSocket(socket) {
  io = socket;
  const onState = (game) => useGames.getState().setGame(game ?? null);
  socket.on('game:state', onState);
  return () => {
    socket.off('game:state', onState);
    io = null;
  };
}

// Truth or Dare
export const todPick = (type) => io?.emit('game:tod-pick', { type });
export const todReroll = () => io?.emit('game:tod-reroll');
export const todDone = () => io?.emit('game:tod-done');
export const todWild = (text) => io?.emit('game:tod-wild', { text });
export const todAdd = (type, text) => io?.emit('game:tod-add', { type, text });

// "Both answer, then reveal" games (Never Have I Ever, Would You Rather, Who's More Likely To)
export const promptPick = (choice) => io?.emit('game:prompt-pick', { choice });
export const promptNext = () => io?.emit('game:prompt-next');
export const promptCategory = (category) => io?.emit('game:prompt-category', { category });
