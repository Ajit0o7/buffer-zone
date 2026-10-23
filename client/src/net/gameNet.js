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
