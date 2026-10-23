import { create } from 'zustand';
import { Vector3 } from 'three';
import { localMotion } from './shared';

// State for the things two players do together: walking hand in hand, sitting, emotes and photo mode. The
// mutable `couple` object is read every frame by the avatars and the player; the zustand store carries only what
// the HUD shows (it changes at human speed).

export const couple = {
  togetherOn: false, // walking together: the guest follows the host, and they hold hands
  sitPressed: false, // set by the E key, consumed by LocalPlayer
  emoteToken: 0, // bumped for each local emote; avatars start the emote when it changes
  emoteId: null,
  remoteEmoteToken: 0, // the same, for emotes the partner sent
  remoteEmoteId: null,
  photo: { on: false, yaw: 0, pitch: 0.15, distance: 4.2, focus: new Vector3() }, // photo mode's orbit camera
};

export const useCouple = create((set) => ({
  together: 'off', // off | asked (I asked) | invited (my partner asked) | on
  seatPrompt: null, // the seat I could sit in right now: { id, label }
  seated: false,
  photoMode: false,
  setTogether: (together) => {
    couple.togetherOn = together === 'on';
    set({ together });
  },
  setSeatPrompt: (seatPrompt) => set({ seatPrompt }),
  setSeated: (seated) => set({ seated }),
  setPhotoMode: (photoMode) => {
    couple.photo.on = photoMode;
    set({ photoMode });
  },
}));

/** Plays an emote on the local avatar (and, through the socket layer, on the partner's copy of it). */
export function playEmote(id) {
  couple.emoteId = id;
  couple.emoteToken += 1;
}

/** Called when the partner's emote arrives. */
export function playRemoteEmote(id) {
  couple.remoteEmoteId = id;
  couple.remoteEmoteToken += 1;
}

// How a seated avatar sits relative to its own origin (its feet), measured from its sit clip once it loads:
// { x, z, y }: the pelvis, in the avatar's frame (x to its left, z forward). Seats use it to place the avatar.
export const sitFits = {};

/** Enters or leaves photo mode (C). Entering starts the camera in front of me, a little off to one side. */
export function togglePhotoMode() {
  const store = useCouple.getState();
  if (store.photoMode) {
    store.setPhotoMode(false);
    return;
  }
  couple.photo.yaw = localMotion.yaw + 0.45;
  couple.photo.pitch = 0.12;
  couple.photo.distance = 3;
  store.setPhotoMode(true);
}

// The shutter: PhotoCapture (inside the canvas) takes the picture on the next frame, then calls back.
export const shutter = { requested: false, onCapture: null };
