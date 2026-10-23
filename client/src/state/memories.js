import { create } from 'zustand';

// Photos the players added in this room (see gallery/memorySlots.js and docs/MEMORIES.md).
export const useMemories = create((set) => ({
  list: [], // { id, index, caption, date, type }
  notice: null, // { text, at }: a toast, e.g. "Sam hung a new memory in the Memory Corridor"
  setList: (list) => set({ list }),
  add: (memory) => set((s) => ({ list: [...s.list.filter((m) => m.id !== memory.id), memory] })),
  remove: (id) => set((s) => ({ list: s.list.filter((m) => m.id !== id) })),
  setNotice: (text) => set({ notice: text ? { text, at: Date.now() } : null }),
  reset: () => set({ list: [], notice: null }),
}));
