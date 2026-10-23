import { create } from 'zustand';

// UI-facing voice chat state. Only flags that change at human speed live here (a person starts or stops
// talking), never anything per-frame.
export const useVoice = create((set) => ({
  status: 'idle', // idle | connecting | connected | failed
  micOn: false,
  micError: null, // blocked | none | insecure | busy | null
  speakingSelf: false,
  speakingPeer: false,
  stream: null, // the partner's MediaStream, once it arrives (read by audio/Voice.jsx)
  set: (patch) => set(patch),
}));
