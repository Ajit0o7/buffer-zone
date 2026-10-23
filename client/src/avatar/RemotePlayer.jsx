import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
import Avatar from './Avatar';
import { localMotion, remote } from '../world/shared';
import { CAPSULE, INTERP_DELAY_MS } from '../world/config';
import { damp } from '../utils/math';
import { couple } from '../world/couple';
import { useSession } from '../state/session';

// The partner looks back at the local player.
const LOOK_AT_LOCAL = { position: localMotion.position, known: true };

export default function RemotePlayer({ avatarId }) {
  const group = useRef();
  // Walking together, the host leads with their right hand: the guest holds with their left, and the other way round.
  const role = useSession((s) => s.role);
  const hold = useMemo(() => ({ active: false, side: role === 'host' ? 'Left' : 'Right', other: localMotion.position }), [role]);
  const motion = useRef({ speed: 0, yaw: 0, anim: 'idle' });
  const sampled = useMemo(() => ({ position: new Vector3(), yaw: 0, speed: 0, anim: 'idle' }), []);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;

    const s = remote.sample(performance.now() - INTERP_DELAY_MS, sampled);
    g.visible = s !== null;
    if (!s) return;

    // Light extra smoothing on top of the interpolation hides the step where a snapshot boundary is crossed.
    g.position.lerp(sampled.position, 1 - Math.exp(-30 * dt));
    motion.current.yaw = sampled.yaw;
    motion.current.speed = damp(motion.current.speed, sampled.speed, 10, dt);
    motion.current.anim = sampled.anim; // 'sit' plays the seated pose
    hold.active = couple.togetherOn;
  });

  return (
    <group ref={group}>
      {/* Synced positions are capsule centres; the model's feet go on the floor below. */}
      <Avatar id={avatarId} motion={motion.current} lookAt={LOOK_AT_LOCAL} footOffset={-CAPSULE.center} holdHand={hold} />
    </group>
  );
}
