import { LoopOnce, MathUtils, Quaternion, Vector3 } from 'three';
import { damp } from '../utils/math';
import { couple } from '../world/couple';
import { burstHearts } from '../world/reactions';
import { EMOTES } from './emotes';
import { armLengths, reach } from './ik';

// Everything an avatar does with a partner or for a partner, layered on its locomotion:
//
//  - emotes: motion-capture clips (wave, cheer, clap, laugh) faded in over whatever it was doing, and arm poses
//    built in code (kiss, heart) laid on top of the animation after it has been evaluated;
//  - sitting: a seated clip that takes over from walking and idling;
//  - holding hands: when walking together, the arm next to the partner reaches for a point halfway between the two.

const UP = new Vector3(0, 1, 0);
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => MathUtils.clamp(t, 0, 1);

const forward = new Vector3();
const right = new Vector3();
const head = new Vector3();
const mouth = new Vector3();
const thrown = new Vector3();
const chest = new Vector3();
const handTarget = new Vector3();
const pole = new Vector3();
const mine = new Vector3();
const middle = new Vector3();
const rootQ = new Quaternion();

const ARM_REACH_HEIGHT = 0.93; // metres above the floor: a held hand hangs about here
const HOLD_DISTANCE = 2.2; // hands only join when the two are this close

/** Creates the layer for one avatar. `bones` are Mixamo-named: RightArm, RightForeArm, RightHand, LeftArm, ..., Head. */
export function createCoupleLayer({ actions, bones, own }) {
  const lengths = {};
  const lengthsFor = (side) => (lengths[side] ??= armLengths(bones[`${side}Arm`], bones[`${side}ForeArm`], bones[`${side}Hand`]));

  const state = {
    sit: 0, // 0..1 how seated it is
    hold: 0, // 0..1 how much it is holding hands
    emote: null, // { id, t, duration, action, cancelled, fade, spawned }
    token: 0, // the last emote request token handled
    wasSeated: false,
  };

  const clipAction = (name) => actions[name] ?? null;

  function startEmote(id, seated) {
    const spec = EMOTES[id];
    if (!spec) return;
    if (seated && !spec.seated) return; // wave, cheer, clap and laugh stand up: not while sitting
    if (state.emote?.action) {
      state.emote.action.stop();
    }
    let action = null;
    let duration = spec.seconds ?? 2.5;
    if (spec.clip) {
      action = clipAction(spec.clip);
      if (!action) return; // this avatar's file has no such clip
      duration = Math.min(action.getClip().duration, spec.maxSeconds ?? 4);
      action.reset();
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      action.setEffectiveWeight(0);
      action.play();
    }
    state.emote = { id, t: 0, duration, action, cancelled: false, fade: 0, spawned: 0 };
  }

  /**
   * Called every frame before the avatar's own weights are applied. Updates the sit and emote weights, and
   * returns how much of the walking/idling pose is left over for locomotion (1 when none of these is active).
   */
  function step(dt, motion) {
    const sitting = motion.anim === 'sit' && !!clipAction('sit');
    state.sit = damp(state.sit, sitting ? 1 : 0, 6, dt);
    const sitAction = clipAction('sit');
    if (sitAction) {
      if (state.sit > 0.01 && !sitAction.isRunning()) sitAction.reset().play();
      sitAction.setEffectiveWeight(state.sit);
      if (state.sit <= 0.01 && sitAction.isRunning()) sitAction.stop();
    }

    // A new emote request (a counter, bumped each time it's pressed).
    const token = own ? couple.emoteToken : couple.remoteEmoteToken;
    if (token !== state.token) {
      state.token = token;
      startEmote(own ? couple.emoteId : couple.remoteEmoteId, sitting);
    }

    let emoteWeight = 0;
    const e = state.emote;
    if (e) {
      e.t += dt;
      const walking = motion.speed > (e.action ? 0.6 : 1.2);
      if (walking || (e.action && sitting)) e.cancelled = true;
      if (e.cancelled) e.fade = Math.min(1, e.fade + dt / 0.25);
      const envelope = Math.min(clamp01(e.t / 0.3), clamp01((e.duration - e.t) / 0.4)) * (1 - e.fade);
      emoteWeight = envelope;
      if (e.action) e.action.setEffectiveWeight(envelope);
      if (e.t >= e.duration || e.fade >= 1) {
        e.action?.stop();
        state.emote = null;
        emoteWeight = 0;
      }
    }
    state.emoteWeight = state.emote?.action ? emoteWeight : 0;

    state.moveScale = 1 - Math.max(state.sit, state.emoteWeight);
    return state.moveScale;
  }

  function armFor(side, targetPoint, polePoint, weight) {
    if (weight <= 0.001) return;
    reach(bones[`${side}Arm`], bones[`${side}ForeArm`], bones[`${side}Hand`], targetPoint, polePoint, lengthsFor(side), weight);
  }

  /**
   * Called after the animation has been evaluated (and the head-look applied): lays the arm poses on top.
   * `r` is the avatar's root group (its world rotation is the way it faces); `holdHand` is
   * { active, side, other: Vector3 | null } for walking together.
   */
  function pose(dt, r, holdHand, motion) {
    r.getWorldQuaternion(rootQ);
    forward.set(0, 0, 1).applyQuaternion(rootQ);
    right.set(-1, 0, 0).applyQuaternion(rootQ); // an avatar's right hand is on its -x side

    // ---- holding hands
    const near = !!(holdHand?.other && holdHand.active);
    r.getWorldPosition(mine);
    let closeEnough = false;
    if (holdHand?.other) {
      const dx = holdHand.other.x - mine.x;
      const dz = holdHand.other.z - mine.z;
      closeEnough = Math.hypot(dx, dz) < HOLD_DISTANCE;
    }
    state.hold = damp(state.hold, near && closeEnough && state.sit < 0.5 ? 1 : 0, 5, dt);
    if (state.hold > 0.01 && holdHand?.other) {
      middle.set((mine.x + holdHand.other.x) / 2, mine.y + ARM_REACH_HEIGHT, (mine.z + holdHand.other.z) / 2);
      // The elbow hangs down and a little away from the partner.
      const away = holdHand.side === 'Right' ? right : right.clone().negate();
      pole.copy(UP).multiplyScalar(-1).addScaledVector(away, 0.5);
      armFor(holdHand.side, middle, pole, state.hold);
    }

    // ---- emotes built in code
    const e = state.emote;
    if (!e || e.action || !bones.Head) return;
    const t = e.t;
    const fadeOut = clamp01((e.duration - t) / 0.5) * (1 - e.fade);
    bones.Head.getWorldPosition(head);

    if (e.id === 'kiss') {
      // Hand rises to the lips, a beat, then throws the kiss out to the side and forward, and drops.
      mouth.copy(head).addScaledVector(forward, 0.12).addScaledVector(UP, 0.02).addScaledVector(right, 0.03);
      thrown.copy(head).addScaledVector(forward, 0.62).addScaledVector(right, 0.28).addScaledVector(UP, -0.02);
      const rise = smooth(clamp01(t / 0.5));
      const fling = smooth(clamp01((t - 0.95) / 0.45));
      handTarget.lerpVectors(mouth, thrown, fling);
      handTarget.y += (1 - rise) * -0.55; // starts from hanging by the side
      handTarget.addScaledVector(right, (1 - rise) * 0.1);
      pole.copy(UP).multiplyScalar(-1).addScaledVector(right, 0.8);
      armFor('Right', handTarget, pole, rise * fadeOut);
      if (!e.spawned && t > 1.2) {
        e.spawned = 1;
        burstHearts(thrown.x, thrown.y + 0.1, thrown.z, 6);
      }
    } else if (e.id === 'heart') {
      // Both hands come together in front of the chest and hold there, pulsing gently, as hearts rise.
      const rise = smooth(clamp01(t / 0.6));
      const pulse = 1 + 0.06 * Math.sin(t * 7);
      chest.copy(head).addScaledVector(UP, -0.3).addScaledVector(forward, 0.3 * pulse);
      chest.y += (1 - rise) * -0.35;
      for (const side of ['Right', 'Left']) {
        const across = side === 'Right' ? right : right.clone().negate();
        handTarget.copy(chest).addScaledVector(across, 0.045);
        pole.copy(UP).multiplyScalar(-1).addScaledVector(across, 0.9);
        armFor(side, handTarget, pole, rise * fadeOut);
      }
      if (e.spawned < 3 && t > 0.9 + e.spawned * 0.7) {
        e.spawned += 1;
        burstHearts(head.x + forward.x * 0.25, head.y + 0.3, head.z + forward.z * 0.25, 3);
      }
    }
  }

  return {
    step,
    pose,
    /** Where a seated avatar's pelvis sits relative to its origin; set once measured. */
    state,
  };
}
