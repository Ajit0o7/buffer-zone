import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CapsuleCollider, RigidBody, useRapier } from '@react-three/rapier';
import { Vector3 } from 'three';
import Avatar from './Avatar';
import { useKeys } from '../input/useKeys';
import { socket } from '../net/socket';
import { RUN_SPEED, SEND_HZ, WALK_SPEED } from '../world/config';
import { localMotion } from '../world/shared';
import { damp, dampAngle } from '../utils/math';

const UP = new Vector3(0, 1, 0);
const CAMERA_DISTANCE = 4.2;
const CAMERA_HEIGHT = 1.8;
const CAMERA_CLEARANCE = 0.25; // keep the lens this far off the wall it hits
const CAPSULE_HALF_HEIGHT = 0.45; // total capsule height = 2 * (half height + radius) = 1.5 m
const CAPSULE_RADIUS = 0.3;
const SEND_INTERVAL = 1 / SEND_HZ;

// Scratch vectors, reused every frame so the render loop allocates nothing.
const moveDir = new Vector3();
const camGoal = new Vector3();
const lookAt = new Vector3();
const toCamera = new Vector3();

/**
 * The local player: a dynamic capsule under Rapier, driven by velocity so walls stop it
 * cleanly. The camera orbits with mouse look (pointer lock).
 */
export default function LocalPlayer({ url }) {
  const body = useRef();
  const keys = useKeys();
  const { camera, gl } = useThree();
  const { world, rapier } = useRapier();
  const cameraYaw = useRef(0);
  const sendTimer = useRef(0);

  // Pointer-lock mouse look. Only active once the canvas has been clicked.
  useEffect(() => {
    const el = gl.domElement;
    const requestLock = () => el.requestPointerLock();
    const onMouseMove = (event) => {
      if (document.pointerLockElement === el) cameraYaw.current -= event.movementX * 0.0025;
    };
    el.addEventListener('click', requestLock);
    document.addEventListener('mousemove', onMouseMove);
    return () => {
      el.removeEventListener('click', requestLock);
      document.removeEventListener('mousemove', onMouseMove);
    };
  }, [gl]);

  useFrame((_, dt) => {
    const b = body.current;
    if (!b) return;

    const { forward, back, left, right, run } = keys.current;
    moveDir.set(Number(right) - Number(left), 0, Number(back) - Number(forward));
    const moving = moveDir.lengthSq() > 0;

    if (moving) moveDir.normalize().applyAxisAngle(UP, cameraYaw.current); // camera-relative input

    const speed = moving ? (run ? RUN_SPEED : WALK_SPEED) : 0;
    const vy = b.linvel().y; // gravity and collisions own the vertical axis
    b.setLinvel({ x: moveDir.x * speed, y: vy, z: moveDir.z * speed }, true);

    if (moving) localMotion.yaw = dampAngle(localMotion.yaw, Math.atan2(moveDir.x, moveDir.z), 12, dt);
    localMotion.speed = speed;
    localMotion.anim = speed === 0 ? 'idle' : speed > WALK_SPEED ? 'run' : 'walk';

    const t = b.translation();
    localMotion.position.set(t.x, t.y, t.z);

    // Third-person follow camera with frame-rate-independent smoothing.
    const yaw = cameraYaw.current;
    camGoal.set(t.x + Math.sin(yaw) * CAMERA_DISTANCE, t.y + CAMERA_HEIGHT, t.z + Math.cos(yaw) * CAMERA_DISTANCE);
    lookAt.set(t.x, t.y + 1.3, t.z);

    // Camera occlusion: cast from the look point toward the camera, and pull in if a wall is in the way.
    toCamera.subVectors(camGoal, lookAt);
    const distance = toCamera.length();
    toCamera.divideScalar(distance);
    const ray = new rapier.Ray(lookAt, toCamera);
    const hit = world.castRay(ray, distance, true, undefined, undefined, undefined, b);
    if (hit) {
      const safe = Math.max(hit.timeOfImpact - CAMERA_CLEARANCE, 0.4);
      camGoal.copy(lookAt).addScaledVector(toCamera, safe);
    }

    camera.position.lerp(camGoal, 1 - Math.exp(-8 * dt));
    camera.lookAt(lookAt);

    // Throttled upload. `volatile` drops the packet rather than queueing a stale one.
    sendTimer.current += dt;
    if (sendTimer.current >= SEND_INTERVAL) {
      sendTimer.current = 0;
      socket.volatile.emit('player:update', {
        p: [t.x, t.y, t.z],
        r: localMotion.yaw,
        a: localMotion.anim,
        v: speed,
      });
    }
  });

  return (
    <RigidBody
      ref={body}
      position={[0, CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS, 0]}
      type="dynamic"
      colliders={false}
      lockRotations
      linearDamping={0.5}
    >
      <CapsuleCollider args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]} />
      <Avatar url={url} motion={localMotion} footOffset={-(CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS)} />
    </RigidBody>
  );
}
