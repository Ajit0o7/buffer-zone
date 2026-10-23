import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CapsuleCollider, RigidBody, useRapier } from '@react-three/rapier';
import { MathUtils, Vector3 } from 'three';
import Avatar from './Avatar';
import { useKeys } from '../input/useKeys';
import { socket } from '../net/socket';
import { useSession } from '../state/session';
import { ACCELERATION, CAMERA, CAPSULE, DECELERATION, GRAVITY, RUN_SPEED, SEND_HZ, WALK_SPEED } from '../world/config';
import { partner } from '../gallery/curtainState';
import { localMotion } from '../world/shared';
import { dampAngle } from '../utils/math';
import { couple, sitFits, useCouple } from '../world/couple';
import { nearestSeat, SEATS } from '../world/seats';
import { endTogether } from '../net/coupleNet';

const UP = new Vector3(0, 1, 0);
const NO_TURN = { x: 0, y: 0, z: 0, w: 1 };


// Rapier character controller. It moves the capsule by shape-casting, so it can't tunnel through
// walls at sprint speed, and it handles steps, slopes and ground contact itself.
const SKIN = 0.02; // gap kept from surfaces; avoids jitter against walls
const STEP_HEIGHT = 0.3; // climbs a step or kerb up to this tall (a stair riser is 18 cm)...
const STEP_MIN_WIDTH = 0.25; // ...when there's room to stand on top, so balustrade bases and urns stay obstacles
const SNAP_TO_GROUND = 0.5; // stays glued to the floor going down steps and the grand stair's ramp
const MAX_SLOPE = (50 * Math.PI) / 180; // walkable incline
const MIN_SLIDE = (35 * Math.PI) / 180; // steeper than this, the capsule slides back down
const WALL_NORMAL_Y = Math.cos(MAX_SLOPE); // a contact flatter than this is ground or a slope, not a wall
const MAX_FALL_SPEED = 30;
const GROUND_STICK = -1; // a small constant pull while grounded keeps ground detection stable
const MAX_DT = 1 / 15; // a stalled tab resumes smoothly instead of leaping
const FELL_OUT_Y = -30; // safety net: respawn if the player ever leaves the map

const SEND_INTERVAL = 1 / SEND_HZ;

// Sitting: how long the walk to the seat takes, and how far above the seat the pelvis rests.
const SIT_SECONDS = 0.7;
const PELVIS_ABOVE_SEAT = 0.07;
const FALLBACK_FIT = { x: 0, y: 0.52, z: -0.05 }; // a seated pelvis, for a model that hasn't measured its own yet

// Walking together: the guest keeps to the host's right-hand side, close enough to hold hands.
const TOGETHER_OFFSET = 0.78;
const FOLLOW_GAIN = 3.2; // 1/s: how hard the guest closes a gap
const FOLLOW_MAX_SPEED = 6.5; // m/s: a gap closes at about a run
const TELEPORT_DISTANCE = 6; // further than this (a lift off the stair, a respawn), the guest is simply brought along
const STUCK_SECONDS = 2.5;

// Photo mode's camera orbit limits.
const PHOTO_PITCH = [-0.25, 1.2];
const PHOTO_DISTANCE = [1.4, 9];

// Scratch vectors, reused every frame so the render loop allocates nothing.
const moveDir = new Vector3();
const groundNormal = new Vector3(0, 1, 0);
const camGoal = new Vector3();
const lookAt = new Vector3();
const toCamera = new Vector3();
const desired = new Vector3();
const seatBody = new Vector3();

const smooth = (t) => t * t * (3 - 2 * t);

/** The capsule centre that puts an avatar's pelvis on a seat: its origin sits where the measured pelvis offset says. */
function seatCentre(seat, fit, out) {
  const f = fit ?? FALLBACK_FIT;
  const c = Math.cos(seat.yaw);
  const sn = Math.sin(seat.yaw);
  return out.set(
    seat.point.x - (f.x * c + f.z * sn),
    seat.point.y + PELVIS_ABOVE_SEAT - f.y + CAPSULE.center,
    seat.point.z - (-f.x * sn + f.z * c),
  );
}

/**
 * The local player: a kinematic capsule driven by Rapier's character controller, plus a
 * third-person camera that orbits with mouse look (pointer lock) and pulls in when a wall is in the way.
 */
export default function LocalPlayer({ avatarId }) {
  const body = useRef();
  const collider = useRef();
  const controller = useRef();
  const keys = useKeys();
  const { camera, gl } = useThree();
  const { world, rapier } = useRapier();
  const role = useSession((s) => s.role);
  // Start side by side across the nave (the open walkway runs along x), not stacked on one spot.
  // West of the grand stair, so the follow camera starts clear of it.
  const spawn = useRef([-3, CAPSULE.center + 0.05, role === 'host' ? -1.5 : 1.5]).current;
  // Start behind the player, looking east up the nave toward the grand stair.
  const cameraYaw = useRef(-Math.PI / 2);
  // The follow camera's orbit: the mouse sets where it should be (`yaw` above, `pitch`, `distance`); what the
  // camera shows eases toward it over a few milliseconds, which takes the jitter out of a mouse without lag.
  const view = useRef({ pitch: CAMERA.pitch, distance: CAMERA.distance, yaw: -Math.PI / 2, pitchNow: CAMERA.pitch, distanceNow: CAMERA.distance, reach: CAMERA.distance, pivot: new Vector3(), ready: false }).current;
  const sendTimer = useRef(0);
  const motion = useRef({ velocity: new Vector3(), verticalSpeed: 0, grounded: false }).current;
  // Sitting: the seat I'm on (or null), how far into getting there, and where I started from.
  const sit = useRef({ seat: null, t: 1, from: new Vector3(), armed: false, promptId: null }).current;
  const follow = useRef({ stuck: 0 }).current;
  // Walking together, the host leads with their right hand: the guest holds with their left, and the other way round.
  const hold = useMemo(() => ({ active: false, side: role === 'host' ? 'Right' : 'Left', other: partner.position }), [role]);

  useEffect(() => {
    const c = world.createCharacterController(SKIN);
    c.enableAutostep(STEP_HEIGHT, STEP_MIN_WIDTH, false);
    c.enableSnapToGround(SNAP_TO_GROUND);
    c.setMaxSlopeClimbAngle(MAX_SLOPE);
    c.setMinSlopeSlideAngle(MIN_SLIDE);
    c.setSlideEnabled(true);
    controller.current = c;
    return () => {
      world.removeCharacterController(c);
      controller.current = null;
    };
  }, [world]);

  // Is there room for a standing player (capsule centre at x, y, z)? Only the house and props count.
  const standShape = useMemo(() => new rapier.Capsule(CAPSULE.halfHeight, CAPSULE.radius - 0.02), [rapier]);
  const roomAt = (x, y, z) => {
    let blocked = false;
    world.intersectionsWithShape({ x, y, z }, NO_TURN, standShape, () => {
      blocked = true;
      return false;
    }, rapier.QueryFilterFlags.ONLY_FIXED);
    return !blocked;
  };
  const standingSpot = (seat, from) => {
    const y = seat.exit.y + CAPSULE.center + 0.05;
    const dx = seat.exit.x - seat.point.x;
    const dz = seat.exit.z - seat.point.z;
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2]) {
      const c = Math.cos(turn);
      const sn = Math.sin(turn);
      const x = seat.point.x + dx * c + dz * sn;
      const z = seat.point.z - dx * sn + dz * c;
      if (roomAt(x, y, z)) return { x, y, z };
    }
    return { x: from.x, y: from.y + 0.05, z: from.z };
  };

  // Development only (stripped from production builds): lets tests and the console move the player.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__teleport = (x, y, z, yaw) => {
      body.current?.setNextKinematicTranslation({ x, y, z });
      if (yaw !== undefined) cameraYaw.current = yaw;
    };
    window.__localMotion = localMotion;
    window.__couple = { couple, store: useCouple, sit, partner, seats: SEATS, sitFits, session: useSession };
    window.__physics = { world, rapier };
    return () => {
      delete window.__teleport;
      delete window.__localMotion;
      delete window.__couple;
      delete window.__physics;
    };
  }, [sit, world, rapier]);

  // Pointer-lock mouse look. Only active once the canvas has been clicked.
  useEffect(() => {
    const el = gl.domElement;
    const requestLock = () => el.requestPointerLock();
    const onMouseMove = (event) => {
      if (document.pointerLockElement !== el) return;
      if (couple.photo.on) {
        // Photo mode: the mouse swings the camera around the two of you.
        couple.photo.yaw -= event.movementX * 0.003;
        couple.photo.pitch = MathUtils.clamp(couple.photo.pitch + event.movementY * 0.003, PHOTO_PITCH[0], PHOTO_PITCH[1]);
      } else {
        // Left-right turns the camera round you; up-down tilts it (mouse down looks down, as in most games).
        cameraYaw.current -= event.movementX * CAMERA.sensitivity;
        view.pitch = MathUtils.clamp(view.pitch + event.movementY * CAMERA.sensitivity * 0.8, CAMERA.pitchMin, CAMERA.pitchMax);
      }
    };
    const onWheel = (event) => {
      if (couple.photo.on) {
        couple.photo.distance = MathUtils.clamp(couple.photo.distance * Math.exp(event.deltaY * 0.001), PHOTO_DISTANCE[0], PHOTO_DISTANCE[1]);
      } else {
        // Scroll to bring the camera closer or send it further back.
        view.distance = MathUtils.clamp(view.distance * Math.exp(event.deltaY * 0.001), CAMERA.minDistance, CAMERA.maxDistance);
      }
    };
    el.addEventListener('click', requestLock);
    el.addEventListener('wheel', onWheel, { passive: true });
    document.addEventListener('mousemove', onMouseMove);
    return () => {
      el.removeEventListener('click', requestLock);
      el.removeEventListener('wheel', onWheel);
      document.removeEventListener('mousemove', onMouseMove);
    };
  }, [gl, view]);

  useFrame((_, rawDt) => {
    const b = body.current;
    const c = controller.current;
    const col = collider.current;
    if (!b || !c || !col) return;
    const dt = Math.min(rawDt, MAX_DT);
    const store = useCouple.getState();
    hold.active = couple.togetherOn;
    const photo = couple.photo.on;
    const t = b.translation();
    let x = t.x;
    let y = t.y;
    let z = t.z;
    let speed = 0;
    let stoodNow = false;

    // ---- Sitting: E sits at the seat in front of you, or stands up again.
    const pressed = couple.sitPressed;
    couple.sitPressed = false;
    const { forward, back, left, right, run } = keys.current;
    const anyMove = forward || back || left || right;

    if (!sit.seat) {
      // Look for a seat within reach, and offer it. A seat my partner is on is taken.
      let offer = null;
      if (!photo && localMotion.speed < 4 && !couple.photo.on) {
        offer = nearestSeat(localMotion.position, (seat) =>
          partner.known && partner.sitting && Math.hypot(partner.position.x - seat.point.x, partner.position.z - seat.point.z) < 0.5);
      }
      const offerId = offer?.id ?? null;
      if (offerId !== sit.promptId) {
        sit.promptId = offerId;
        store.setSeatPrompt(offer ? { id: offer.id, label: offer.label } : null);
      }
      if (pressed && offer) {
        sit.seat = offer;
        sit.t = 0;
        sit.armed = false;
        sit.from.set(x, y, z);
        motion.velocity.set(0, 0, 0);
        store.setSeated(true);
        store.setSeatPrompt(null);
        sit.promptId = null;
        endTogether(); // one of you sitting down ends the walk
      }
    } else {
      if (!anyMove) sit.armed = true; // the walking key that brought me here must be let go of first
      if (pressed || (sit.armed && sit.t >= 1 && anyMove)) {
        // Stand up in front of the seat, or, if something is there, beside it, or back where I sat down from:
        // never inside a wall, where the controller couldn't move again.
        const spot = standingSpot(sit.seat, sit.from);
        sit.seat = null;
        x = spot.x;
        y = spot.y;
        z = spot.z;
        motion.velocity.set(0, 0, 0);
        motion.verticalSpeed = 0;
        motion.grounded = false;
        b.setNextKinematicTranslation({ x, y, z });
        store.setSeated(false);
        stoodNow = true;
        localMotion.anim = 'idle';
        localMotion.speed = 0;
      }
    }

    if (sit.seat) {
      // Seated: no walking. Glide onto the seat, turn to face the way it faces, and stay.
      sit.t = Math.min(1, sit.t + dt / SIT_SECONDS);
      const e = smooth(sit.t);
      seatCentre(sit.seat, sitFits[avatarId], seatBody);
      x = sit.from.x + (seatBody.x - sit.from.x) * e;
      z = sit.from.z + (seatBody.z - sit.from.z) * e;
      y = sit.from.y + (seatBody.y - sit.from.y) * e + Math.sin(Math.PI * e) * 0.06;
      b.setNextKinematicTranslation({ x, y, z });
      localMotion.yaw = dampAngle(localMotion.yaw, sit.seat.yaw, 8, dt);
      localMotion.speed = 0;
      localMotion.anim = 'sit';
      localMotion.position.set(x, y, z);
    } else if (stoodNow) {
      // Just stood up: the body is moving to the standing spot this step, so the controller has nothing to do yet.
      localMotion.position.set(x, y, z);
    } else {
      // ---- Walking. Input is relative to where the camera looks; photo mode freezes the player.
      const togetherNow = couple.togetherOn;
      const followLeader = togetherNow && role === 'guest' && partner.known;
      let moving;
      let targetSpeed = 0;
      let teleported = false;

      if (followLeader) {
        // The guest walks beside the host, at their right: wherever the host goes, the guest goes too.
        const sy = Math.sin(partner.yaw);
        const cy = Math.cos(partner.yaw);
        const goalX = partner.position.x - cy * TOGETHER_OFFSET;
        const goalZ = partner.position.z + sy * TOGETHER_OFFSET;
        const gapX = goalX - x;
        const gapZ = goalZ - z;
        const gap = Math.hypot(gapX, gapZ);
        desired.set(sy * partner.speed + gapX * FOLLOW_GAIN, 0, cy * partner.speed + gapZ * FOLLOW_GAIN);
        if (desired.length() > FOLLOW_MAX_SPEED) desired.setLength(FOLLOW_MAX_SPEED);
        if (gap < 0.06 && partner.speed < 0.1) desired.set(0, 0, 0);
        moving = desired.lengthSq() > 0.0025;
        follow.stuck = gap > 1.6 && Math.hypot(motion.velocity.x, motion.velocity.z) < 0.3 ? follow.stuck + dt : 0;
        if (gap > TELEPORT_DISTANCE || follow.stuck > STUCK_SECONDS) {
          follow.stuck = 0;
          x = goalX;
          y = partner.position.y;
          z = goalZ;
          motion.velocity.set(0, 0, 0);
          motion.verticalSpeed = 0;
          b.setNextKinematicTranslation({ x, y, z });
          teleported = true;
        }
        // Standing still beside the host, face the way they face.
        if (!moving && gap < 0.4) localMotion.yaw = dampAngle(localMotion.yaw, partner.yaw, 4, dt);
      } else {
        moveDir.set(Number(right) - Number(left), 0, Number(back) - Number(forward));
        moving = !photo && moveDir.lengthSq() > 0;
        if (moving) moveDir.normalize().applyAxisAngle(UP, cameraYaw.current);
        // Hand in hand is a stroll: no running.
        targetSpeed = moving ? (run && !togetherNow ? RUN_SPEED : WALK_SPEED) : 0;
        desired.copy(moveDir).multiplyScalar(moving ? targetSpeed : 0);
      }

      if (!teleported) {
        // Tuned damping: ease toward the target velocity, a little faster when stopping.
        const k = 1 - Math.exp(-(moving ? ACCELERATION : DECELERATION) * dt);
        motion.velocity.x += (desired.x - motion.velocity.x) * k;
        motion.velocity.z += (desired.z - motion.velocity.z) * k;
        motion.verticalSpeed = motion.grounded
          ? GROUND_STICK
          : Math.max(motion.verticalSpeed - GRAVITY * dt, -MAX_FALL_SPEED);

        // On the ground, aim the move along the ground's own slope (keeping its horizontal speed), so the
        // controller doesn't shorten a push into a ramp: the stair climbs at full walking pace.
        const alongSlope = motion.grounded
          ? -(groundNormal.x * motion.velocity.x + groundNormal.z * motion.velocity.z) / groundNormal.y
          : 0;

        // Let the controller resolve walls, steps, slopes and the ground.
        c.computeColliderMovement(col, {
          x: motion.velocity.x * dt,
          y: (motion.verticalSpeed + alongSlope) * dt,
          z: motion.velocity.z * dt,
        });
        const m = c.computedMovement();
        motion.grounded = c.computedGrounded();
        // Against a wall, what actually happened becomes the velocity, so sliding along it doesn't keep
        // pushing into it. Slopes and the stair don't count: feeding their (shorter) horizontal movement
        // back in would slow the player a little more every frame, down to a crawl on the grand stair.
        groundNormal.set(0, 1, 0);
        for (let i = 0; i < c.numComputedCollisions(); i++) {
          const hit = c.computedCollision(i);
          if (!hit) continue;
          const n = hit.normal1;
          if (Math.abs(n.y) < WALL_NORMAL_Y) {
            motion.velocity.x = m.x / dt;
            motion.velocity.z = m.z / dt;
          } else if (Math.abs(n.y) < groundNormal.y) {
            groundNormal.set(n.x, n.y, n.z).multiplyScalar(Math.sign(n.y)); // the slope underfoot, pointing up
          }
        }

        x = t.x + m.x;
        y = t.y + m.y;
        z = t.z + m.z;
        if (y < FELL_OUT_Y) {
          [x, y, z] = spawn;
          motion.velocity.set(0, 0, 0);
          motion.verticalSpeed = 0;
        }
        b.setNextKinematicTranslation({ x, y, z });

        // Animation speed: distance actually covered along the ground, climbing included, so the legs keep
        // walking at the right rate up and down the stair.
        const across = Math.hypot(m.x, m.z) / dt;
        speed = motion.grounded ? Math.hypot(across, m.y / dt) : across;
        if (across > 0.1) localMotion.yaw = dampAngle(localMotion.yaw, Math.atan2(m.x, m.z), 12, dt);
      }
      localMotion.speed = speed;
      localMotion.anim = speed < 0.1 ? 'idle' : speed > WALK_SPEED + 0.5 ? 'run' : 'walk';
      localMotion.position.set(x, y, z);
    }
    speed = localMotion.speed;

    // ---- Camera.
    if (photo) {
      // Photo mode: orbit the midpoint of the two of you (or just me, with no partner nearby).
      const P = couple.photo;
      let spread = 0;
      if (partner.known && Math.abs(partner.position.y - y) < 3 && Math.hypot(partner.position.x - x, partner.position.z - z) < 14) {
        P.focus.set((x + partner.position.x) / 2, (y + partner.position.y) / 2 + 0.35, (z + partner.position.z) / 2);
        spread = Math.hypot(partner.position.x - x, partner.position.z - z);
      } else {
        P.focus.set(x, y + 0.35, z);
      }
      const distance = P.distance + spread * 0.9;
      const flat = Math.cos(P.pitch);
      camGoal.set(P.focus.x + Math.sin(P.yaw) * flat * distance, P.focus.y + Math.sin(P.pitch) * distance, P.focus.z + Math.cos(P.yaw) * flat * distance);
      lookAt.copy(P.focus);
    } else {
      // Third-person orbit camera. The point it circles follows the player smoothly; the orbit itself follows the
      // mouse closely; and a wall in the way pulls the camera in at once and lets it back out gently.
      if (!view.ready) {
        view.pivot.set(x, y, z);
        view.yaw = cameraYaw.current;
        view.ready = true;
      }
      view.pivot.x += (x - view.pivot.x) * (1 - Math.exp(-14 * dt));
      view.pivot.y += (y - view.pivot.y) * (1 - Math.exp(-10 * dt));
      view.pivot.z += (z - view.pivot.z) * (1 - Math.exp(-14 * dt));
      view.yaw = dampAngle(view.yaw, cameraYaw.current, 28, dt);
      view.pitchNow += (view.pitch - view.pitchNow) * (1 - Math.exp(-28 * dt));
      view.distanceNow += (view.distance - view.distanceNow) * (1 - Math.exp(-10 * dt));
      lookAt.set(view.pivot.x, view.pivot.y + CAMERA.lookHeight, view.pivot.z);
      const flat = Math.cos(view.pitchNow);
      toCamera.set(Math.sin(view.yaw) * flat, Math.sin(view.pitchNow), Math.cos(view.yaw) * flat);
    }

    // Development only: tests can place the camera anywhere ({ p: [x, y, z], t: [x, y, z] }).
    if (import.meta.env.DEV && window.__cam) {
      camGoal.fromArray(window.__cam.p);
      lookAt.fromArray(window.__cam.t);
      camera.position.copy(camGoal);
      camera.lookAt(lookAt);
    } else if (photo) {
      // Photo mode: pull in if a wall is in the way, then ease toward the orbit position.
      toCamera.subVectors(camGoal, lookAt);
      const distance = toCamera.length();
      toCamera.divideScalar(distance);
      const hit = world.castRay(new rapier.Ray(lookAt, toCamera), distance, true, rapier.QueryFilterFlags.ONLY_FIXED);
      if (hit) camGoal.copy(lookAt).addScaledVector(toCamera, Math.max(hit.timeOfImpact - CAMERA.clearance, 0.5));
      camera.position.lerp(camGoal, 1 - Math.exp(-10 * dt));
      camera.lookAt(lookAt);
    } else {
      const wanted = view.distanceNow;
      const hit = world.castRay(new rapier.Ray(lookAt, toCamera), wanted, true, rapier.QueryFilterFlags.ONLY_FIXED);
      const room = hit ? Math.max(hit.timeOfImpact - CAMERA.clearance, 0.4) : wanted;
      view.reach = room < view.reach ? room : view.reach + (room - view.reach) * (1 - Math.exp(-4 * dt));
      camera.position.copy(lookAt).addScaledVector(toCamera, view.reach);
      // Never below the floor under you, when tilted to look up.
      camera.position.y = Math.max(camera.position.y, view.pivot.y - CAPSULE.center + 0.25);
      camera.lookAt(lookAt);
    }

    // Throttled upload. `volatile` drops the packet rather than queueing a stale one.
    sendTimer.current += dt;
    if (sendTimer.current >= SEND_INTERVAL) {
      sendTimer.current = 0;
      socket.volatile.emit('player:update', {
        p: [x, y, z],
        r: localMotion.yaw,
        a: localMotion.anim,
        v: speed,
      });
    }
  });

  return (
    <RigidBody ref={body} position={spawn} type="kinematicPosition" colliders={false}>
      <CapsuleCollider ref={collider} args={[CAPSULE.halfHeight, CAPSULE.radius]} />
      <Avatar id={avatarId} motion={localMotion} lookAt={partner} footOffset={-CAPSULE.center} holdHand={hold} own />
    </RigidBody>
  );
}
