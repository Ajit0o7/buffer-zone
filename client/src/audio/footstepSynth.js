// Footsteps built from the physics of a step rather than a noise burst, in a handful of layers:
//
//   heel strike    a very short, bright click: the hard sole meeting the floor
//   body           a low-mid burst, 220-900 Hz: the sole and the stone beneath it giving the step its weight
//   floor thud     a low damped tone that drops in pitch, from the slab taking the weight
//   knock          a mid-pitched tone, from the sole and the stone beneath it
//   tile ring      two narrow, high resonances that ring briefly, as stone tile does
//   toe slap       the forefoot coming down a moment later (sooner when running), softer and duller
//
// Every variant randomises each layer a little (pitch, timing, level), so no two steps are identical.
// Carpet keeps only the muffled thud and a soft toe. To use real recordings, list their URLs in
// FOOTSTEP_SAMPLES in world/config.js: they replace these.
//
// The balance was tuned by measurement rather than by ear: stone steps centre on about 2 kHz (A-weighted),
// as hard soles on stone do, with a little under a fifth of their energy in the low mids; carpet centres
// below 1 kHz. docs/AUDIO.md has the numbers and how to retune.

const TAU = Math.PI * 2;
const LENGTH = 0.5; // seconds per step

/** Small seeded generator, so a step sounds the same on every machine. */
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

const between = (r, lo, hi) => lo + (hi - lo) * r();
const onePole = (fc, sr) => 1 - Math.exp((-TAU * fc) / sr);

/** Band-limited noise burst with an exponential decay, added into `out` starting at `start` seconds. */
function noiseBurst(out, sr, r, { start, tau, hp, lp, gain, attack = 0.0004 }) {
  const aHp = onePole(hp, sr);
  const aLp = onePole(lp, sr);
  // Filtering white noise to a band leaves only a slice of its power. Scale the burst back up, so `gain` means
  // the level of the band itself (its RMS at the start of the burst) wherever the band sits.
  gain *= Math.min(12, 1.15 / (0.577 * Math.sqrt(Math.max(lp - hp, 200) / (sr / 2))));
  // Two one-pole stages each way, so the band has steep edges and doesn't leak into its neighbours.
  let low1 = 0;
  let low2 = 0;
  let y1 = 0;
  let y2 = 0;
  const first = Math.floor(start * sr);
  const n = Math.min(out.length - first, Math.floor(tau * sr * 7));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const x = r() * 2 - 1;
    low1 += aHp * (x - low1);
    const h1 = x - low1;
    low2 += aHp * (h1 - low2);
    const h2 = h1 - low2; // high-passed twice
    y1 += aLp * (h2 - y1);
    y2 += aLp * (y1 - y2); // low-passed twice
    const env = Math.exp(-t / tau) * Math.min(1, t / attack);
    out[first + i] += y2 * env * gain;
  }
}

/** Damped sine, optionally gliding downward from `f * (1 + glide)` as it decays. */
function tone(out, sr, { start, f, tau, gain, glide = 0, glideTau = 0.01 }) {
  const first = Math.floor(start * sr);
  const n = Math.min(out.length - first, Math.floor(tau * sr * 7));
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    phase += (TAU * f * (1 + glide * Math.exp(-t / glideTau))) / sr;
    out[first + i] += Math.sin(phase) * Math.exp(-t / tau) * Math.min(1, t / 0.0008) * gain;
  }
}

function stone(r, sr, running) {
  const out = new Float32Array(Math.floor(LENGTH * sr));
  // Heel: bright and brief. The mid-band noise gives it body, the high band the click.
  noiseBurst(out, sr, r, { start: 0, tau: between(r, 0.004, 0.008), hp: between(r, 700, 1100), lp: between(r, 2800, 4800), gain: between(r, 0.26, 0.36), attack: 0.0003 });
  // The body of the step: the sole and the slab beneath it, in the low mids.
  noiseBurst(out, sr, r, { start: 0, tau: between(r, 0.012, 0.02), hp: 220, lp: between(r, 650, 950), gain: between(r, 0.7, 0.95), attack: 0.0005 });
  noiseBurst(out, sr, r, { start: 0, tau: 0.0012, hp: 2500, lp: 7000, gain: between(r, 0.08, 0.14), attack: 0.0001 });
  tone(out, sr, { start: 0, f: between(r, 75, 110), tau: between(r, 0.03, 0.045), gain: between(r, 0.4, 0.58), glide: 0.35, glideTau: 0.012 });
  tone(out, sr, { start: 0.001, f: between(r, 180, 270), tau: between(r, 0.012, 0.02), gain: between(r, 0.3, 0.45) });
  // Stone tile rings, faintly.
  tone(out, sr, { start: 0.002, f: between(r, 1100, 1800), tau: between(r, 0.02, 0.035), gain: between(r, 0.05, 0.1) });
  tone(out, sr, { start: 0.002, f: between(r, 2600, 3500), tau: between(r, 0.012, 0.022), gain: between(r, 0.03, 0.06) });
  // Toe: the forefoot lands 85-120 ms later when walking, 25-45 ms when running, softer and duller.
  const toe = running ? between(r, 0.025, 0.045) : between(r, 0.085, 0.12);
  const toeGain = running ? between(r, 0.22, 0.32) : between(r, 0.14, 0.24);
  noiseBurst(out, sr, r, { start: toe, tau: between(r, 0.006, 0.01), hp: 300, lp: between(r, 1400, 2400), gain: toeGain });
  tone(out, sr, { start: toe, f: between(r, 100, 150), tau: between(r, 0.015, 0.025), gain: toeGain * 1.1, glide: 0.2 });
  // A touch of scuff as the sole settles.
  noiseBurst(out, sr, r, { start: toe + 0.02, tau: 0.03, hp: 1500, lp: 4500, gain: between(r, 0.02, 0.05), attack: 0.01 });
  return out;
}

function carpet(r, sr, running) {
  const out = new Float32Array(Math.floor(LENGTH * sr));
  noiseBurst(out, sr, r, { start: 0, tau: between(r, 0.012, 0.02), hp: 150, lp: between(r, 500, 800), gain: between(r, 0.1, 0.16), attack: 0.002 });
  tone(out, sr, { start: 0, f: between(r, 60, 90), tau: between(r, 0.05, 0.075), gain: between(r, 0.8, 1), glide: 0.25, glideTau: 0.02 });
  const toe = running ? between(r, 0.03, 0.05) : between(r, 0.09, 0.13);
  noiseBurst(out, sr, r, { start: toe, tau: between(r, 0.015, 0.025), hp: 120, lp: 700, gain: between(r, 0.12, 0.2), attack: 0.003 });
  tone(out, sr, { start: toe, f: between(r, 70, 100), tau: 0.04, gain: 0.35 });
  return out;
}

const GENERATORS = { stone, carpet };

/**
 * Builds `count` variants per surface and gait, as AudioBuffers.
 * Returns { stone: { walk: [..], run: [..] }, carpet: { walk, run } }.
 */
export function synthesizeFootsteps(context, count = 8) {
  const sr = context.sampleRate;
  const sets = {};
  let seed = 1;
  for (const [surface, make] of Object.entries(GENERATORS)) {
    sets[surface] = { walk: [], run: [] };
    for (const gait of ['walk', 'run']) {
      for (let k = 0; k < count; k++) {
        const data = make(rng((seed += 7919)), sr, gait === 'run');
        let peak = 0;
        for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
        const scale = peak > 0 ? 0.9 / peak : 1; // every variant peaks the same: loudness comes from the player's speed
        const buffer = context.createBuffer(1, data.length, sr);
        const channel = buffer.getChannelData(0);
        // A short fade at the end so the buffer never stops on a click.
        const fade = Math.floor(0.02 * sr);
        for (let i = 0; i < data.length; i++) channel[i] = data[i] * scale * (i > data.length - fade ? (data.length - i) / fade : 1);
        sets[surface][gait].push(buffer);
      }
    }
  }
  return sets;
}
