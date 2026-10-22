import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Audio, AudioContext, AudioListener, AudioLoader, Object3D, PositionalAudio, Vector3 } from 'three';
import { roomAt } from '../world/rooms';
import { localMotion, remote } from '../world/shared';
import { INTERP_DELAY_MS } from '../world/config';
import { damp } from '../utils/math';

const MUSIC_URL = '/audio/romantic-theme.ogg';
const FOOTSTEP_URL = '/audio/footstep.ogg';
const MUSIC_BASE_VOLUME = 0.55;
const STEP_LENGTH = 0.9; // metres per footstep, sets the cadence from the partner's speed

const loadBuffer = (url) =>
  new Promise((resolve, reject) => new AudioLoader().load(url, resolve, undefined, reject));

/**
 * Two layers:
 *  - Room music: non-positional, volume eases up or down as you move between zones.
 *  - Partner footsteps: positional, anchored to the partner, so they pan and attenuate with distance.
 * Browsers require a user gesture before audio plays; Lobby.jsx calls AudioContext.resume() for that.
 */
export default function SpatialAudio() {
  const { camera } = useThree();
  const [listener] = useState(() => new AudioListener());
  const [buffers, setBuffers] = useState(null);

  const music = useMemo(() => new Audio(listener), [listener]);
  const anchor = useMemo(() => new Object3D(), []);
  const footstep = useMemo(() => {
    const sound = new PositionalAudio(listener);
    sound.setRefDistance(2); // full volume within 2 m
    sound.setRolloffFactor(1.6);
    sound.setDistanceModel('inverse');
    return sound;
  }, [listener]);
  const stride = useRef(0);
  const partner = useMemo(() => ({ position: new Vector3(), yaw: 0, speed: 0, anim: 'idle' }), []);

  useEffect(() => {
    camera.add(listener);
    // Starts the music once audio is unlocked. Safe to call repeatedly.
    const startMusic = () => {
      AudioContext.getContext().resume().then(() => {
        if (!music.isPlaying && music.buffer) music.play();
      });
    };
    anchor.add(footstep); // the sound follows the anchor, which tracks the partner
    let cancelled = false;
    Promise.all([loadBuffer(MUSIC_URL), loadBuffer(FOOTSTEP_URL)])
      .then(([musicBuffer, stepBuffer]) => {
        if (cancelled) return;
        music.setBuffer(musicBuffer);
        music.setLoop(true);
        music.setVolume(0);
        footstep.setBuffer(stepBuffer);
        setBuffers(true);
        startMusic();
      })
      .catch((err) => console.warn('[audio] could not load clips', err));

    startMusic();
    window.addEventListener('pointerdown', startMusic, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener('pointerdown', startMusic);
      camera.remove(listener);
      anchor.remove(footstep);
      music.stop();
    };
  }, [camera, listener, music, footstep, anchor]);

  useFrame((_, dt) => {
    // Music follows the room you're standing in.
    const room = roomAt(localMotion.position);
    const target = (room?.music ?? 0.25) * MUSIC_BASE_VOLUME;
    if (music.buffer) music.setVolume(damp(music.getVolume(), target, 2, dt));

    // Footsteps for the partner, cadence proportional to their speed.
    const sample = remote.sample(performance.now() - INTERP_DELAY_MS, partner);
    if (!sample) return;
    anchor.position.copy(partner.position);
    if (!buffers || !footstep.buffer) return;
    if (partner.speed > 0.4) {
      stride.current += (partner.speed / STEP_LENGTH) * dt;
      if (stride.current >= 1) {
        stride.current -= 1;
        if (footstep.isPlaying) footstep.stop();
        footstep.play();
      }
    } else {
      stride.current = 0;
    }
  });

  return <primitive object={anchor} />;
}
