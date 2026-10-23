import { create } from 'zustand';

// Rendering tier, chosen by the performance governor. It changes rarely (a few times a session at
// most), so React state is fine here; per-frame values never go through this store.
//   low       - tone mapping only; no bloom, no mirror floor, no sunbeams or decoration
//   medium    - like high, but the marble floor has no mirror reflections (its costliest effect)
//   high      - bloom, colour grade, mirror-polished floor and tone mapping (the default)
//   cinematic - adds SSAO and depth of field; opt-in only, never chosen automatically
const forced = new URLSearchParams(window.location.search).get('quality');

export const usePerf = create((set) => ({
  tier: ['low', 'medium', 'cinematic'].includes(forced) ? forced : 'high',
  forced: ['low', 'medium', 'high', 'cinematic'].includes(forced),
  setTier: (tier) => set((s) => (s.forced || s.tier === tier ? s : { tier })),
}));
