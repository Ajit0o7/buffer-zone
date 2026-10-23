// The courtyard fountain's trickle, synthesized rather than recorded, in three layers:
//
//   splash bed   band-passed noise (roughly 400 Hz-5 kHz) with a fast, irregular wobble in level: the
//                broken hiss of sheets of water landing in the basin
//   murmur       a quieter, darker band (150-700 Hz): the body of water churning under the streams
//   droplets     many tiny "plinks": a sine whose pitch glides upward as it decays, which is how a
//                bubble trapped by a falling drop rings (1-4 kHz), with a few louder ones now and then
//
// The buffer loops without a seam: every slow modulation completes a whole number of cycles per loop,
// droplets that run past the end wrap round to the start, and the noise layers are rendered a little
// long and crossfaded into their own beginning.

const TAU = Math.PI * 2;
const OVERLAP = 0.25; // seconds of noise crossfaded across the loop point
const CONTROL = 32; // samples per step of the slow modulations

/** Small seeded generator, so the fountain sounds the same on every machine. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const onePole = (fc, sr) => 1 - Math.exp((-TAU * fc) / sr);

/** A smooth random curve that repeats exactly every `cycles`-th of the loop: a few sines on whole-cycle counts. */
function loopingWobble(r, cycles) {
  const parts = cycles.map((c) => ({ c, phase: r() * TAU, amp: 0.5 + r() }));
  const norm = parts.reduce((s, p) => s + p.amp, 0);
  return (u) => {
    let v = 0;
    for (const p of parts) v += p.amp * Math.sin(TAU * p.c * u + p.phase);
    return v / norm; // -1..1
  };
}

/** Noise band-limited to hp..lp with two one-pole stages each way, `length` samples long. */
function bandNoise(r, sr, length, hp, lp) {
  const out = new Float32Array(length);
  const aHp = onePole(hp, sr);
  const aLp = onePole(lp, sr);
  let l1 = 0;
  let l2 = 0;
  let y1 = 0;
  let y2 = 0;
  // Run the filters in for a moment first, so the band starts settled rather than from silence.
  for (let i = -2000; i < length; i++) {
    const x = r() * 2 - 1;
    l1 += aHp * (x - l1);
    const h1 = x - l1;
    l2 += aHp * (h1 - l2);
    const h2 = h1 - l2;
    y1 += aLp * (h2 - y1);
    y2 += aLp * (y1 - y2);
    if (i >= 0) out[i] = y2;
  }
  return out;
}

/** Folds the extra `tail` samples past `length` back over the start with an equal-power crossfade. */
function foldLoop(data, length, tail) {
  const out = data.subarray(0, length);
  for (let i = 0; i < tail; i++) {
    const k = (i + 0.5) / tail;
    out[i] = data[i] * Math.sin((k * Math.PI) / 2) + data[length + i] * Math.cos((k * Math.PI) / 2);
  }
  return out;
}

/** One droplet: an upward-gliding, quickly decaying sine, added into the loop at `start` (wrapping round). */
function droplet(out, sr, start, { f, tau, glide, gain }) {
  const n = Math.floor(tau * sr * 6);
  const L = out.length;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    phase += (TAU * f * (1 + glide * (1 - Math.exp(-t / tau)))) / sr;
    const env = Math.exp(-t / tau) * Math.min(1, t / 0.0006);
    out[(start + i) % L] += Math.sin(phase) * env * gain;
  }
}

/**
 * A loopable mono AudioBuffer of fountain trickle, `seconds` long (default 8). `context` only needs
 * `sampleRate` and `createBuffer` (any BaseAudioContext will do). The result peaks at 0.9.
 */
export function createFountainBuffer(context, seconds = 8) {
  const sr = context.sampleRate;
  const length = Math.max(1, Math.round(seconds * sr));
  const tail = Math.min(Math.floor(OVERLAP * sr), Math.floor(length / 4));
  const r = rng(20240611);

  // Modulations: cycles per loop, so each repeats exactly. Higher counts give the bubbly flutter.
  const surge = loopingWobble(r, [1, 2, 3]); // the whole thing breathing, every few seconds
  const flutter = loopingWobble(r, [37, 53, 71, 97]); // water breaking up, several times a second
  const churn = loopingWobble(r, [5, 9, 13]);

  const splashRaw = bandNoise(r, sr, length + tail, 420, 5200);
  const murmurRaw = bandNoise(r, sr, length + tail, 150, 700);
  // Apply the (periodic) modulation before folding, so the crossfade blends like with like.
  // The curves are evaluated once per CONTROL samples and interpolated: a sine per sample per layer is slow.
  const steps = Math.ceil(length / CONTROL) + 1;
  const splashGain = new Float32Array(steps + 1);
  const murmurGain = new Float32Array(steps + 1);
  for (let k = 0; k <= steps; k++) {
    const u = ((k * CONTROL) % length) / length;
    splashGain[k] = (0.75 + 0.18 * surge(u)) * (0.7 + 0.3 * flutter(u));
    murmurGain[k] = 0.55 * (0.8 + 0.2 * churn(u));
  }
  for (let i = 0; i < length + tail; i++) {
    const j = i % length;
    const k = Math.floor(j / CONTROL);
    const f = (j - k * CONTROL) / CONTROL;
    splashRaw[i] *= splashGain[k] + (splashGain[k + 1] - splashGain[k]) * f;
    murmurRaw[i] *= murmurGain[k] + (murmurGain[k + 1] - murmurGain[k]) * f;
  }
  const splash = foldLoop(splashRaw, length, tail);
  const murmur = foldLoop(murmurRaw, length, tail);

  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = splash[i] + murmur[i];

  // Droplets: about 26 a second, mostly faint; one in twelve is a clearer plink.
  let energy = 0;
  for (let i = 0; i < length; i++) energy += out[i] * out[i];
  const rms = Math.sqrt(energy / length) || 1;
  const count = Math.round(seconds * 26);
  for (let k = 0; k < count; k++) {
    const loud = r() < 1 / 12;
    droplet(out, sr, Math.floor(r() * length), {
      f: 900 + r() * (loud ? 1500 : 3000),
      tau: 0.004 + r() * (loud ? 0.014 : 0.007),
      glide: 0.3 + r() * 0.9,
      gain: rms * (loud ? 2.2 + r() * 1.6 : 0.5 + r() * 0.9),
    });
  }

  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const scale = peak > 0 ? 0.9 / peak : 1;
  const buffer = context.createBuffer(1, length, sr);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) channel[i] = out[i] * scale;
  return buffer;
}
