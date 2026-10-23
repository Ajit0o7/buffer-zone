import { create } from 'zustand';

// Whether the house has appeared at least once. Set by the scene when its first load completes; from then on the
// loading screen never shows again, whatever streams in later (photos behind curtains, a memory a partner adds).
export const useLoading = create((set) => ({
  sceneReady: false,
  setSceneReady: () => set({ sceneReady: true }),
}));
