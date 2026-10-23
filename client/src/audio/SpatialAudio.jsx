import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Audio, AudioContext, AudioListener, AudioLoader, Group, PositionalAudio } from 'three';
import { musicLevelAt, roomAt } from '../world/rooms';
import { localMotion } from '../world/shared';
import { steps } from '../world/footsteps';
import { FOOTSTEP_SAMPLES, RUN_SPEED, WALK_SPEED } from '../world/config';
import { damp } from '../utils/math';
import { LANDING, STAIR_START } from '../scene/GrandStair';
import { synthesizeFootsteps } from './footstepSynth';
import { installReverb } from './reverb';
import Voice from './Voice';

const MUSIC_URL = '/audio/romantic-theme.wav';
const MUSIC_BASE_VOLUME = 0.55;
const POOL = 8; // footsteps that can sound at once (two players, plus their tails)
const REVERB_WET = { atrium: 0.24, balcony: 0.2, corridor: 0.14, study: 0.1, salon: 0.1 }; // by room: big hall, small rooms

const loadBuffer = (url) =>
  new Promise((resolve, reject) => new AudioLoader().load(url, resolve, undefined, reject));

/** Loads each surface's real recordings, if any are listed in config; otherwise null (use the synthesis). */
async function loadRecordedSteps() {
  const sets = {};
  for (const [surface, urls] of Object.entries(FOOTSTEP_SAMPLES)) {
    if (!urls?.length) continue;
    const buffers = await Promise.all(urls.map(loadBuffer));
    sets[surface] = { walk: buffers, run: buffers };
  }
  return Object.keys(sets).length ? sets : null;
}

// The grand stair's red runner: steps on it fall softly.
const onCarpet = (x, y, z) => y > 0.12 && Math.abs(z) < 0.8 && x > STAIR_START - 0.2 && x < LANDING.west + 0.8;

/**
 * Three layers:
 *  - Room music: non-positional, its volume eases as you move between rooms.
 *  - Footsteps, both players': one sound per foot contact, played where the foot landed, with a surface
 *    (stone or the carpeted stair), a gait (walk or run), a random variant and a little pitch variation.
 *  - A stone-hall reverb that everything sits in, wetter in the atrium and drier in the small rooms.
 * Browsers require a user gesture before audio plays; Lobby.jsx calls AudioContext.resume() for that.
 */
export default function SpatialAudio() {
  const { camera } = useThree();
  const [listener] = useState(() => new AudioListener());
  const [ready, setReady] = useState(false);

  const music = useMemo(() => new Audio(listener), [listener]);
  const voices = useMemo(() => new Group(), []);
  const pool = useMemo(
    () =>
      Array.from({ length: POOL }, () => {
        const sound = new PositionalAudio(listener);
        // Tuned for large halls: full volume within 2.5 m, then a firm falloff, so a partner's steps carry
        // down the nave but are only a murmur from the far end.
        sound.setRefDistance(2.5);
        sound.setRolloffFactor(1.5);
        sound.setDistanceModel('inverse');
        sound.setMaxDistance(60);
        voices.add(sound);
        return sound;
      }),
    [listener, voices],
  );
  const state = useRef({ next: 0, steps: null, last: new Map(), reverb: null }).current;

  useEffect(() => {
    camera.add(listener);
    state.reverb = installReverb(listener, REVERB_WET.atrium);
    // Starts the music once audio is unlocked. Safe to call repeatedly.
    const startMusic = () => {
      AudioContext.getContext().resume().then(() => {
        if (!music.isPlaying && music.buffer) music.play();
      });
    };
    let cancelled = false;
    (async () => {
      try {
        const [musicBuffer, recorded] = await Promise.all([loadBuffer(MUSIC_URL), loadRecordedSteps()]);
        if (cancelled) return;
        state.steps = recorded ?? synthesizeFootsteps(listener.context);
        music.setBuffer(musicBuffer);
        music.setLoop(true);
        music.setVolume(0);
        setReady(true);
        startMusic();
      } catch (err) {
        console.warn('[audio] could not load clips', err);
      }
    })();

    startMusic();
    // Opening an invite link isn't a user gesture, so the first click or key press unlocks the audio.
    window.addEventListener('pointerdown', startMusic, { once: true });
    window.addEventListener('keydown', startMusic, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('pointerdown', startMusic);
      window.removeEventListener('keydown', startMusic);
      camera.remove(listener);
      state.reverb?.dispose();
      for (const sound of pool) if (sound.isPlaying) sound.stop();
      music.stop();
    };
  }, [camera, listener, music, pool, state]);

  useFrame((_, dt) => {
    // Music follows the room you're in, crossfading across room edges.
    const target = musicLevelAt(localMotion.position) * MUSIC_BASE_VOLUME;
    if (music.buffer) music.setVolume(damp(music.getVolume(), target, 1.2, dt));

    // Reverb follows the room too: the nave is a hall, the side rooms are not.
    const room = roomAt(localMotion.position);
    state.reverb?.setWet(damp(state.reverb.level ?? REVERB_WET.atrium, REVERB_WET[room?.id] ?? REVERB_WET.atrium, 1.5, dt));

    // Footsteps: one per contact event. Drain the queue even before the sounds exist, so none are stale.
    while (steps.length) {
      const step = steps.shift();
      if (state.steps && ready) playStep(step);
    }
  });

  // Development only: lets tests and the console see which steps were played.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__audio = { played: [], state, listener };
    return () => delete window.__audio;
  }, [state, listener]);

  function playStep(step) {
    const { x, y, z, speed, foot, own } = step;
    const surface = onCarpet(x, y, z) && state.steps.carpet ? 'carpet' : 'stone';
    const gait = speed > (WALK_SPEED + RUN_SPEED) / 2 ? 'run' : 'walk';
    const variants = (state.steps[surface] ?? state.steps.stone)[gait];

    // Never the same variant twice running for one foot, so a stride doesn't sound like a loop.
    const key = `${own}:${foot}`;
    let pick = Math.floor(Math.random() * variants.length);
    if (pick === state.last.get(key)) pick = (pick + 1) % variants.length;
    state.last.set(key, pick);

    const sound = pool[state.next];
    state.next = (state.next + 1) % pool.length;
    if (sound.isPlaying) sound.stop();
    sound.setBuffer(variants[pick]);
    // Louder when faster, a touch different each time; the left foot sits a little lower than the right.
    const pace = Math.min(1, speed / RUN_SPEED);
    sound.setVolume((own ? 0.55 : 0.8) * (0.55 + 0.6 * pace) * (0.92 + 0.16 * Math.random()));
    sound.setPlaybackRate((foot ? 1.03 : 0.97) * (0.94 + 0.12 * Math.random()));
    sound.position.set(x, y, z);
    sound.updateMatrixWorld(true);
    sound.play();
    if (import.meta.env.DEV) window.__audio?.played.push({ t: performance.now(), surface, gait, own, foot, pick, x: +x.toFixed(2), z: +z.toFixed(2) });
  }

  return (
    <>
      <primitive object={voices} />
      <Voice listener={listener} />
    </>
  );
}
