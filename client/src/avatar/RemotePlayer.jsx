import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import Avatar from './Avatar';
import { remoteTarget } from '../world/shared';
import { damp, dampAngle } from '../utils/math';

// The partner is visual only: no collider, because the server's view is always slightly behind.
// Position is interpolated toward the latest sample so 20 Hz updates look like 60 fps motion.
const POSITION_LAMBDA = 14;

export default function RemotePlayer({ url }) {
  const group = useRef();
  const motion = useRef({ speed: 0, yaw: 0 });

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    g.visible = remoteTarget.hasData;
    if (!remoteTarget.hasData) return;

    g.position.lerp(remoteTarget.position, 1 - Math.exp(-POSITION_LAMBDA * dt));
    motion.current.yaw = dampAngle(motion.current.yaw, remoteTarget.yaw, 12, dt);
    motion.current.speed = damp(motion.current.speed, remoteTarget.speed, 10, dt);
  });

  return (
    <group ref={group}>
      <Avatar url={url} motion={motion.current} />
    </group>
  );
}
