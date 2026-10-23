import { AnimationMixer, Vector3 } from 'three';

const SAMPLES = 96; // poses measured per clip
const PLANTED = 0.22; // a foot is planted while its ankle is in the lowest 22 % of its range over the cycle

const normalise = (name) => name.replace(/^mixamorig[:_]?/, '');
const findBone = (root, name) => {
  let found = null;
  root.traverse((o) => {
    if (!found && o.isBone && normalise(o.name) === name) found = o;
  });
  return found;
};

/**
 * When, in a looping clip, each foot lands: [{ foot: 0 | 1, phase }] with phase in 0..1 of the clip's length.
 *
 * It plays the clip on a throwaway copy of the character, measures how high each ankle is at every sample, and
 * finds where each foot comes down into its lowest stretch. That moment is the heel strike, and it falls at a
 * fixed point in the cycle, so playing the sound there keeps steps in time with the feet at any frame rate
 * (and at any playback speed), which watching the ankles frame by frame can't do on a slow device.
 *
 * `scene` must be a clone that nothing else is animating. Returns [] for clips that don't walk (idle).
 */
export function measureContacts(scene, clip, feet = ['LeftFoot', 'RightFoot']) {
  const bones = feet.map((name) => findBone(scene, name));
  if (bones.some((b) => !b) || clip.duration <= 0) return [];

  const mixer = new AnimationMixer(scene);
  mixer.clipAction(clip).play();
  const heights = bones.map(() => new Float32Array(SAMPLES));
  const p = new Vector3();
  for (let i = 0; i < SAMPLES; i++) {
    mixer.setTime((i / SAMPLES) * clip.duration);
    scene.updateMatrixWorld(true);
    bones.forEach((bone, k) => {
      heights[k][i] = bone.getWorldPosition(p).y;
    });
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  const contacts = [];
  heights.forEach((h, foot) => {
    const lo = Math.min(...h);
    const hi = Math.max(...h);
    if (hi - lo < 0.04) return; // the foot barely moves: not walking or running
    const limit = lo + (hi - lo) * PLANTED;
    for (let i = 0; i < SAMPLES; i++) {
      const before = h[(i + SAMPLES - 1) % SAMPLES];
      if (before > limit && h[i] <= limit) {
        // Interpolate where the ankle crossed the limit, between the two samples.
        const t = (before - limit) / (before - h[i]);
        contacts.push({ foot, phase: ((i - 1 + t + SAMPLES) % SAMPLES) / SAMPLES });
      }
    }
  });
  return contacts.sort((a, b) => a.phase - b.phase);
}
