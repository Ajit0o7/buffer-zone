import { Quaternion, Vector3 } from 'three';

// Small tools for posing an arm on top of the animation: used for hand-holding, blowing a kiss and the heart
// gesture. They run after the animation mixer each frame, so they add to this frame's pose and never accumulate.

const cur = new Vector3();
const p0 = new Vector3();
const p1 = new Vector3();
const delta = new Quaternion();
const identity = new Quaternion();
const boneWorld = new Quaternion();
const parentWorld = new Quaternion();

/**
 * Turns `bone` (about its own joint) so that the line from it to `child` points along `dir` (a world direction),
 * blended by `weight` (0 leaves the animation alone, 1 aims fully).
 */
export function aimBone(bone, child, dir, weight = 1) {
  bone.getWorldPosition(p0);
  child.getWorldPosition(p1);
  cur.subVectors(p1, p0);
  if (cur.lengthSq() < 1e-10) return;
  cur.normalize();
  delta.setFromUnitVectors(cur, dir);
  if (weight < 1) delta.slerp(identity.set(0, 0, 0, 1), 1 - weight); // part of the way from "no change" to the full turn
  bone.getWorldQuaternion(boneWorld);
  boneWorld.premultiply(delta);
  bone.parent.getWorldQuaternion(parentWorld);
  bone.quaternion.copy(parentWorld.invert().multiply(boneWorld));
  bone.updateMatrixWorld(true);
}

/** The lengths of an arm's two segments, from its current pose (they never change). */
export function armLengths(arm, fore, hand) {
  arm.getWorldPosition(p0);
  fore.getWorldPosition(p1);
  const upper = p0.distanceTo(p1);
  hand.getWorldPosition(p0);
  return { upper, lower: p0.distanceTo(p1) };
}

const shoulder = new Vector3();
const toTarget = new Vector3();
const elbow = new Vector3();
const bend = new Vector3();
const aim = new Vector3();

/**
 * Two-bone reach: puts the hand at `target` (as far as the arm allows) with the elbow out toward `pole`, a direction
 * the elbow should favour (down and outward, for a relaxed arm). `weight` blends it with the animation.
 */
export function reach(arm, fore, hand, target, pole, lengths, weight = 1) {
  if (weight <= 0.001) return;
  arm.getWorldPosition(shoulder);
  toTarget.subVectors(target, shoulder);
  const { upper, lower } = lengths;
  const d = Math.min(Math.max(toTarget.length(), Math.abs(upper - lower) + 1e-3), upper + lower - 1e-3);
  toTarget.normalize();
  const a = (upper * upper - lower * lower + d * d) / (2 * d); // along the line to the target
  const h = Math.sqrt(Math.max(upper * upper - a * a, 0)); // out to the side: the elbow's bend
  bend.copy(pole).addScaledVector(toTarget, -pole.dot(toTarget));
  if (bend.lengthSq() < 1e-6) bend.set(0, -1, 0).addScaledVector(toTarget, toTarget.y);
  bend.normalize();
  elbow.copy(shoulder).addScaledVector(toTarget, a).addScaledVector(bend, h);

  aimBone(arm, fore, aim.subVectors(elbow, shoulder).normalize(), weight);
  fore.getWorldPosition(elbow); // where the elbow actually ended up (not exactly there when the blend is partial)
  aimBone(fore, hand, aim.subVectors(target, elbow).normalize(), weight);
}
