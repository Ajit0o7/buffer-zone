import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
import Avatar from './Avatar';
import { remote } from '../world/shared';
import { INTERP_DELAY_MS } from '../world/config';
import { damp } from '../utils/math';

export default function RemotePlayer({ url }) {
  const group = useRef();
  const motion = useRef({ speed: 0, yaw: 0 });
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
  });

  return (
    <group ref={group}>
      <Avatar url={url} motion={motion.current} />
    </group>
  );
}
