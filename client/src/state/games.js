import { create } from 'zustand';

// The game the two of you are playing, as the server last described it to this player (server/src/games.js
// viewFor), plus the menu's open state. Changes at human speed, so React state is fine.
export const useGames = create((set) => ({
  game: null, // null | hunt view | quiz view
  menuOpen: false,
  receivedAt: 0, // performance.now() when `game` arrived (the hunt's clock runs on from there)
  setGame: (game) => set({ game, receivedAt: performance.now() }),
  setMenuOpen: (menuOpen) => set({ menuOpen }),
}));
