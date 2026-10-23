// A small bell, synthesized: a few inharmonic partials with a quick strike and a soft ring. Played straight to the
// speakers (it's a game sound, not a sound in the room). `pitch` shifts it, so a run of finds climbs a scale.

const PARTIALS = [
  [1, 1, 1.4],
  [2.76, 0.45, 0.9],
  [5.4, 0.2, 0.5],
  [8.93, 0.08, 0.3],
]; // [frequency ratio, level, seconds to fade]

export function playChime(context, { pitch = 1, volume = 0.22, delay = 0 } = {}) {
  if (!context || context.state !== 'running') return;
  const t0 = context.currentTime + delay;
  const base = 880 * pitch;
  const out = context.createGain();
  out.gain.value = volume;
  out.connect(context.destination);
  for (const [ratio, level, fade] of PARTIALS) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.frequency.value = base * ratio;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(level, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + fade);
    osc.connect(gain).connect(out);
    osc.start(t0);
    osc.stop(t0 + fade + 0.05);
  }
  setTimeout(() => out.disconnect(), (delay + 2) * 1000);
}

/** A rising arpeggio, for finding the last heart. */
export function playFanfare(context) {
  [1, 1.26, 1.5, 2].forEach((p, i) => playChime(context, { pitch: p, volume: 0.24, delay: i * 0.14 }));
}
