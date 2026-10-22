import { create } from 'zustand';

// Only the reconnect credentials are persisted, and only per tab (sessionStorage).
const STORAGE_KEY = 'buffer-zone:session';

function readPersisted() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {}; // storage blocked or corrupt: start clean
  }
}

function persist({ roomId, role, token }) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ roomId, role, token }));
  } catch {
    // Non-fatal: the user simply has to re-enter the key after a refresh.
  }
}

const saved = readPersisted();

export const useSession = create((set, get) => ({
  roomId: saved.roomId ?? null,
  role: saved.role ?? null, // 'host' | 'guest'
  token: saved.token ?? null,
  key: null, // host-only, in memory, shown until the partner joins
  peerConnected: false,
  activePhoto: null,

  setSession: (patch) => {
    set(patch);
    persist(get());
  },
  setPeerConnected: (peerConnected) => set({ peerConnected }),
  setActivePhoto: (activePhoto) => set({ activePhoto }),
  clear: () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    set({ roomId: null, role: null, token: null, key: null, peerConnected: false });
  },
}));
