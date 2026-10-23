// A log fire, synthesized: a soft low roar (filtered noise) with crackles and pops scattered over it. Loopable: the
// roar is cross-faded across the seam and no crackle straddles it.

/** Returns a mono AudioBuffer `seconds` long, made in `context` (anything with createBuffer and sampleRate). */
export function createFireBuffer(context, seconds = 9) {
  const rate = context.sampleRate;
  const n = Math.floor(seconds * rate);
  const buffer = context.createBuffer(1, n, rate);
  const out = buffer.getChannelData(0);
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  // Roar: brown-ish noise (integrated white noise, leaky), slowly swelling.
  const fade = Math.floor(0.5 * rate);
  const roar = new Float32Array(n + fade);
  let b = 0;
  for (let i = 0; i < roar.length; i++) {
    b = 0.985 * b + (rand() * 2 - 1) * 0.06;
    roar[i] = b * (0.75 + 0.25 * Math.sin((i / rate) * 0.9) * Math.sin((i / rate) * 0.37 + 1));
  }
  for (let i = 0; i < n; i++) out[i] = roar[i] * 0.35;
  for (let i = 0; i < fade; i++) {
    // The tail beyond the end fades in over the start, so the loop has no seam.
    const t = i / fade;
    out[i] = out[i] * t + roar[n + i] * 0.35 * (1 - t);
  }

  // Crackles: short bright bursts, mostly small, sometimes a pop; in little clusters, as wood does.
  let t = 0.05;
  while (t < seconds - 0.1) {
    const cluster = 1 + Math.floor(rand() * 4);
    for (let c = 0; c < cluster; c++) {
      const start = Math.floor((t + c * (0.01 + rand() * 0.05)) * rate);
      const big = rand() < 0.12;
      const length = Math.floor((big ? 0.02 + rand() * 0.03 : 0.002 + rand() * 0.01) * rate);
      const amp = big ? 0.5 + rand() * 0.35 : 0.08 + rand() * 0.3;
      let hp = 0;
      let last = 0;
      for (let i = 0; i < length && start + i < n - 1; i++) {
        const w = rand() * 2 - 1;
        hp = 0.6 * (hp + w - last); // a crude high-pass: crackles are bright
        last = w;
        const env = Math.exp((-i / length) * 5);
        out[start + i] += hp * amp * env;
      }
    }
    t += 0.04 + rand() * rand() * 0.6;
  }

  // Keep it under full scale.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.95) for (let i = 0; i < n; i++) out[i] *= 0.95 / peak;
  return buffer;
}
