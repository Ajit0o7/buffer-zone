// A stone-hall reverb, as a convolution with a synthetic impulse response: a few early reflections
// off the walls, then a dense tail that dies slowly in the lows (about 3 s) and quickly in the highs
// (about 1.2 s), as in a large stone room. It is a send on the listener's output, so everything
// that is heard (footsteps, music) sits in the same space.

const TAU = Math.PI * 2;

function impulseResponse(context, { seconds = 3.2, preDelay = 0.02, lowT60 = 3.0, highT60 = 1.15 } = {}) {
  const sr = context.sampleRate;
  const n = Math.floor(seconds * sr);
  const ir = context.createBuffer(2, n, sr);
  const aLow = 1 - Math.exp((-TAU * 900) / sr);
  let seed = 12345;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
  const early = [0.011, 0.017, 0.029, 0.043, 0.061, 0.083]; // wall reflections, in seconds
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let low = 0;
    for (let i = Math.floor(preDelay * sr); i < n; i++) {
      const t = i / sr - preDelay;
      const x = noise();
      low += aLow * (x - low);
      const high = x - low;
      const tail = low * Math.exp((-6.9 * t) / lowT60) + high * Math.exp((-6.9 * t) / highT60);
      data[i] = tail * Math.min(1, t / 0.03); // grows in over 30 ms, so it doesn't smear the click
    }
    early.forEach((d, k) => {
      const at = Math.floor((preDelay + d * (ch === 0 ? 1 : 1.13)) * sr);
      if (at < n) data[at] += (ch === k % 2 ? 0.9 : 0.6) * Math.exp(-k * 0.35) * (k % 2 ? -1 : 1);
    });
  }
  // Normalise to unit energy per channel, so the wet level means the same whatever the length.
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let e = 0;
    for (let i = 0; i < n; i++) e += data[i] * data[i];
    const s = 1 / Math.sqrt(e || 1);
    for (let i = 0; i < n; i++) data[i] *= s;
  }
  return ir;
}

/**
 * Adds a reverb send to a three.js AudioListener. Returns { setWet(level), dispose() }.
 * `wet` is the reverb's level relative to the dry sound (about 0.2 reads as a large room).
 */
export function installReverb(listener, wet = 0.2) {
  const context = listener.context;
  const convolver = context.createConvolver();
  convolver.normalize = false;
  convolver.buffer = impulseResponse(context);
  const send = context.createGain();
  send.gain.value = wet;
  listener.gain.connect(convolver);
  convolver.connect(send);
  send.connect(context.destination);
  const reverb = {
    level: wet,
    setWet: (level) => {
      reverb.level = level;
      send.gain.value = level;
    },
    dispose() {
      try {
        listener.gain.disconnect(convolver);
      } catch {
        // already disconnected
      }
      convolver.disconnect();
      send.disconnect();
    },
  };
  return reverb;
}
