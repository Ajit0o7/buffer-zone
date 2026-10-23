import { AudioContext } from 'three';
import { socket } from '../net/socket';
import { useVoice } from '../state/voice';

// Peer-to-peer voice chat over WebRTC. The two browsers exchange their connection setup (an offer, an
// answer and ICE candidates) through the game server's socket ('voice:signal'), and from then on the
// audio flows directly between them: the server never touches it.
//
// The host makes the offer, the guest answers; both use one audio transceiver that is sendrecv from the
// start, so turning a microphone on or off is just replaceTrack(): no renegotiation, no glitch. Each
// time the partner (re)joins the host starts a new session id, so a stale answer from an old call is ignored.

const ICE_SERVERS = (() => {
  try {
    return JSON.parse(import.meta.env.VITE_ICE_SERVERS) ?? undefined;
  } catch {
    return undefined;
  }
})() ?? [{ urls: 'stun:stun.l.google.com:19302' }];

const SPEAKING_LEVEL = 0.02; // RMS of the signal, 0..1
const SPEAKING_HANGOVER_MS = 350; // stays "speaking" through short pauses between words

const call = {
  pc: null,
  sid: null,
  role: null,
  sender: null,
  queued: [], // ICE candidates that arrived before the remote description
  mic: null, // { stream, track, source, analyser, timer }
};

const set = (patch) => useVoice.getState().set(patch);
const send = (kind, data) => socket.emit('voice:signal', { sid: call.sid, kind, data });
const newSid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** Watches an audio stream's loudness and reports when someone starts or stops talking. */
export function watchSpeaking(source, analyser, onChange) {
  const samples = new Float32Array(analyser.fftSize);
  let speaking = false;
  let lastLoud = 0;
  source.connect(analyser); // the analyser is a dead end: it isn't connected to the speakers
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const now = performance.now();
    if (Math.sqrt(sum / samples.length) > SPEAKING_LEVEL) lastLoud = now;
    const nowSpeaking = now - lastLoud < SPEAKING_HANGOVER_MS;
    if (nowSpeaking !== speaking) {
      speaking = nowSpeaking;
      onChange(speaking);
    }
  }, 100);
  return () => {
    clearInterval(timer);
    try {
      source.disconnect(analyser);
    } catch {
      // already disconnected
    }
    if (speaking) onChange(false);
  };
}

function makePeer() {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.onicecandidate = (e) => {
    if (e.candidate) send('candidate', e.candidate.toJSON());
  };
  pc.ontrack = (e) => set({ stream: e.streams[0] ?? new MediaStream([e.track]) });
  pc.onconnectionstatechange = () => {
    if (pc !== call.pc) return;
    const s = pc.connectionState;
    if (s === 'connected') set({ status: 'connected' });
    else if (s === 'failed') {
      set({ status: 'failed' });
      if (call.role === 'host') pc.restartIce(); // a fresh offer with new candidates
    } else if (s === 'connecting' || s === 'new') set({ status: 'connecting' });
  };
  return pc;
}

function closePeer(notify = false) {
  if (notify && call.pc && call.sid) send('bye', null);
  call.pc?.close();
  Object.assign(call, { pc: null, sid: null, sender: null, queued: [] });
  set({ status: 'idle', stream: null, speakingPeer: false });
}

/** The host starts a call: one audio transceiver, and the offer follows when the browser asks for it. */
export function startCall(role) {
  call.role = role;
  if (role !== 'host') return;
  closePeer();
  call.sid = newSid();
  call.pc = makePeer();
  set({ status: 'connecting' });
  const pc = call.pc;
  pc.onnegotiationneeded = async () => {
    try {
      await pc.setLocalDescription();
      if (pc === call.pc) send('offer', { sdp: pc.localDescription.sdp });
    } catch (err) {
      console.warn('[voice] could not make an offer', err);
    }
  };
  const transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
  call.sender = transceiver.sender;
  if (call.mic) call.sender.replaceTrack(call.mic.track);
}

export function endCall(notify = true) {
  closePeer(notify);
}

async function flushCandidates() {
  const list = call.queued.splice(0);
  for (const c of list) {
    try {
      await call.pc.addIceCandidate(c);
    } catch (err) {
      console.warn('[voice] bad ICE candidate', err);
    }
  }
}

/**
 * The guest says its page is ready. An offer the host sent while the guest was still loading its scene went
 * nowhere, so the host sends a fresh one now.
 */
export function sayHello() {
  socket.emit('voice:signal', { sid: 'hello', kind: 'hello', data: null });
}

async function onSignal({ sid, kind, data }) {
  if (kind === 'hello') {
    if (call.role === 'host') startCall('host');
    return;
  }
  if (kind === 'bye') {
    if (sid === call.sid && call.role === 'guest') closePeer();
    return;
  }

  if (kind === 'offer') {
    if (call.role !== 'guest') return;
    if (sid !== call.sid) {
      closePeer(); // a new call from the host: forget the old one
      call.sid = sid;
      call.pc = makePeer();
      set({ status: 'connecting' });
    }
    const pc = call.pc;
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      const transceiver = pc.getTransceivers()[0];
      transceiver.direction = 'sendrecv';
      call.sender = transceiver.sender;
      if (call.mic) call.sender.replaceTrack(call.mic.track);
      await pc.setLocalDescription();
      send('answer', { sdp: pc.localDescription.sdp });
      await flushCandidates();
    } catch (err) {
      console.warn('[voice] could not answer', err);
    }
    return;
  }

  if (sid !== call.sid || !call.pc) return; // from a call that no longer exists

  if (kind === 'answer') {
    try {
      await call.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      await flushCandidates();
    } catch (err) {
      console.warn('[voice] bad answer', err);
    }
  } else if (kind === 'candidate') {
    if (!call.pc.remoteDescription) call.queued.push(data);
    else call.pc.addIceCandidate(data).catch((err) => console.warn('[voice] bad ICE candidate', err));
  }
}

/** Listens for the partner's signals. Returns the cleanup. */
export function bindVoiceSignals() {
  socket.on('voice:signal', onSignal);
  return () => {
    socket.off('voice:signal', onSignal);
    stopMic();
    closePeer(true);
    call.role = null;
  };
}

// ---- Microphone ----------------------------------------------------------------------------------

export async function startMic() {
  if (call.mic) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    // Browsers only offer the microphone on https:// pages, and on localhost.
    return set({ micError: 'insecure' });
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const track = stream.getAudioTracks()[0];
    const context = AudioContext.getContext();
    context.resume();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    const stopWatching = watchSpeaking(source, analyser, (speakingSelf) => set({ speakingSelf }));
    call.mic = { stream, track, source, stopWatching };
    track.onended = stopMic; // unplugged, or revoked in the browser
    call.sender?.replaceTrack(track);
    set({ micOn: true, micError: null });
  } catch (err) {
    const name = err?.name;
    set({
      micOn: false,
      micError: name === 'NotAllowedError' || name === 'SecurityError' ? 'blocked' : name === 'NotFoundError' ? 'none' : 'busy',
    });
  }
}

export function stopMic() {
  const mic = call.mic;
  if (!mic) return;
  call.mic = null;
  mic.stopWatching();
  mic.source.disconnect();
  mic.stream.getTracks().forEach((t) => t.stop()); // releases the microphone: the browser's recording light goes out
  call.sender?.replaceTrack(null);
  set({ micOn: false, speakingSelf: false });
}

export const toggleMic = () => (call.mic ? stopMic() : startMic());
