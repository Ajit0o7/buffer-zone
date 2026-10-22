import { create } from 'zustand';

// Rendering tier, chosen by the performance governor. It changes rarely (a few times a session at
// most), so React state is fine here; per-frame values never go through this store.
//   low       - tone mapping only; no bloom
//   high      - bloom, colour grade and tone mapping (the default)
//   cinematic - adds SSAO and depth of field; opt-in only, never chosen automatically
const forced = new URLSearchParams(window.location.search).get('quality');

export const usePerf = create((set) => ({
  tier: forced === 'low' || forced === 'cinematic' ? forced : 'high',
  forced: forced === 'low' || forced === 'high' || forced === 'cinematic',
  setTier: (tier) => set((s) => (s.forced || s.tier === tier ? s : { tier })),
}));
