import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { partner } from '../gallery/curtainState';
import { localMotion } from '../world/shared';
import { useSession } from '../state/session';
import { useVoice } from '../state/voice';
import { bindVoiceSignals, endCall, sayHello, startCall, watchSpeaking } from './voiceNet';

// Voice carries further than footsteps, but still fades with distance: full volume within 1.5 m, about
// a third at 5 m, a murmur across the nave. It also dulls with distance (a low-pass filter closes), so
// a partner who is close sounds clear, and one far down the hall sounds far away. On another floor, the
// ceiling muffles it further.
const REF_DISTANCE = 1.5;
const ROLLOFF = 1.2;
const VOICE_GAIN = 1.7;
const MUFFLE_PER_METRE = 0.25;
const BRIGHT = 14000; // Hz, filter cutoff for a partner standing next to you
const DULL = 900; // Hz, the darkest it gets
const FLOOR_MUFFLE = 0.45; // cutoff multiplier when the partner is on another floor
const MOUTH_HEIGHT = 0.7; // from the capsule centre

const rel = new Vector3();

/**
 * Voice chat: sets the call up when the partner is here, and plays their voice from where they are.
 * Must sit inside the Canvas, next to the audio listener it is given.
 */
export default function Voice({ listener }) {
  const camera = useThree((s) => s.camera);
  const role = useSession((s) => s.role);
  const peerConnected = useSession((s) => s.peerConnected);
  const stream = useVoice((s) => s.stream);

  useEffect(() => bindVoiceSignals(), []);

  // The host calls whenever the partner is in the room; the guest answers.
  useEffect(() => {
    if (!role) return undefined;
    if (!peerConnected) {
      endCall(false);
      return undefined;
    }
    startCall(role);
    if (role === 'guest') sayHello(); // in case the host's offer came while this page was still loading
    return () => endCall(false);
  }, [role, peerConnected]);

  // The partner's voice, as a positioned source: stream -> low-pass -> panner -> gain -> listener output.
  const chain = useMemo(() => {
    if (!stream) return null;
    const ctx = listener.context;
    // Chrome only delivers a WebRTC stream to Web Audio once an element has been given it. It stays muted:
    // the sound we hear is the Web Audio chain below.
    const element = new Audio();
    element.muted = true;
    element.srcObject = stream;
    element.play().catch(() => {});

    const source = ctx.createMediaStreamSource(stream);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = BRIGHT;
    filter.Q.value = 0.5;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = REF_DISTANCE;
    panner.rolloffFactor = ROLLOFF;
    panner.maxDistance = 120;
    const gain = ctx.createGain();
    gain.gain.value = VOICE_GAIN;
    source.connect(filter);
    filter.connect(panner);
    panner.connect(gain);
    gain.connect(listener.getInput());
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    const stopWatching = watchSpeaking(source, analyser, (speakingPeer) => useVoice.getState().set({ speakingPeer }));
    return { element, source, filter, panner, gain, stopWatching };
  }, [stream, listener]);

  useEffect(() => {
    if (!chain) return undefined;
    return () => {
      chain.stopWatching();
      chain.source.disconnect();
      chain.filter.disconnect();
      chain.panner.disconnect();
      chain.gain.disconnect();
      chain.element.srcObject = null;
    };
  }, [chain]);

  // Development only: lets tests and the console inspect the voice chain.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__voice = {
      store: useVoice,
      chain: () =>
        chain && {
          x: chain.panner.positionX.value,
          y: chain.panner.positionY.value,
          z: chain.panner.positionZ.value,
          cutoff: Math.round(chain.filter.frequency.value),
          contextState: listener.context.state,
        },
    };
    return () => delete window.__voice;
  }, [chain, listener]);

  useFrame(() => {
    if (!chain || !partner.known) return;
    const { panner, filter } = chain;
    const now = listener.context.currentTime;
    // The partner's position relative to the player, placed around the listener (the camera, which rides
    // behind the player): distance is player to partner, and direction is as the camera sees it.
    rel.copy(partner.position).sub(localMotion.position);
    rel.y += MOUTH_HEIGHT;
    panner.positionX.setTargetAtTime(camera.position.x + rel.x, now, 0.03);
    panner.positionY.setTargetAtTime(camera.position.y + rel.y, now, 0.03);
    panner.positionZ.setTargetAtTime(camera.position.z + rel.z, now, 0.03);

    const distance = rel.length();
    let cutoff = Math.min(BRIGHT, Math.max(DULL, BRIGHT / (1 + MUFFLE_PER_METRE * distance)));
    if (Math.abs(rel.y - MOUTH_HEIGHT) > 2.5) cutoff *= FLOOR_MUFFLE;
    filter.frequency.setTargetAtTime(Math.max(DULL * 0.6, cutoff), now, 0.08);
  });

  return null;
}
