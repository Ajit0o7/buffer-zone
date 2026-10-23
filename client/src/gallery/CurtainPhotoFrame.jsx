import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import {
  DataTexture,
  Euler,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { useGallery } from './GalleryBatch';
import { acquireTexture, releaseTexture } from './textureCache';
import { curtainOverrides, partner, setCurtainOverride } from './curtainState';
import { CURTAIN, PAINTING } from './dimensions';
import { useSession } from '../state/session';
import { localMotion } from '../world/shared';
import { isVisible, registerTarget, unregisterTarget } from '../world/visibility';
import { GALLERY, MANSION_SCALE } from '../world/config';
import { damp } from '../utils/math';

// Shared by every frame: geometry is identical, so it is built once.
const paintingGeometry = new PlaneGeometry(PAINTING.width, PAINTING.height);
const hitGeometry = new PlaneGeometry(CURTAIN.width, CURTAIN.height);
const hitMaterial = new MeshBasicMaterial({ visible: false }); // raycastable, never drawn

// 1×1 white stand-in, so every painting material compiles with a map from the start. Swapping in
// the real photo is then a uniform change, never a shader recompile mid-walk. It is never drawn
// (a painting stays hidden until its photo arrives), so no artwork costs VRAM before it's revealed.
const BLANK = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat);
BLANK.colorSpace = SRGBColorSpace;
BLANK.needsUpdate = true;

const PHOTO_GLOW = 0.5; // how much of a photo's brightness is its own light
const SNAP_PROBE = 0.8; // the wall probe starts this far in front of the configured anchor
const SNAP_REACH = 3.5; // and searches this far behind it
const SNAP_GAP = 0.02; // gap left between the wall and the back of the frame
const SNAP_ATTEMPTS = 30; // physics needs a step or two before its colliders can be queried
const DRAW_DISTANCE = 80; // paintings beyond this aren't drawn at all
const ALWAYS_DRAW = 12; // nearer than this, a painting is drawn whatever the zone bake says
// Where visibility is tested from: the centre and corners of the curtain, a little out from the wall.
const SIGHT_POINTS = [
  [0, 0],
  [-CURTAIN.width * 0.45, CURTAIN.rodY - 0.05],
  [CURTAIN.width * 0.45, CURTAIN.rodY - 0.05],
  [-CURTAIN.width * 0.45, CURTAIN.rodY - CURTAIN.height + 0.05],
  [CURTAIN.width * 0.45, CURTAIN.rodY - CURTAIN.height + 0.05],
];

// A frame's centre hangs 2 m above its floor; a standing player's capsule centre is 0.9 m up.
const CENTRE_ABOVE_PLAYER = 1.1;
const FLOOR_PENALTY = 4; // metres of distance per metre of height beyond the first

/**
 * How far a player is from a painting, for its triggers: horizontal distance on the same floor, so the
 * hanging height doesn't matter, growing fast with height difference, so a painting on the balcony
 * doesn't open for someone walking underneath it (and one halfway up the stair counts as nearby).
 */
function reach(position, anchor) {
  const across = Math.hypot(position.x - anchor.x, position.z - anchor.z);
  const up = Math.abs(anchor.y - CENTRE_ABOVE_PLAYER - position.y);
  return across + Math.max(0, up - 1) * FLOOR_PENALTY;
}

const IDENTITY_SCALE = new Vector3(1, 1, 1);
const scratchMatrix = new Matrix4();
const scratchOrigin = new Vector3();

/** Crops the photo to fill the painting area without stretching (CSS "object-fit: cover"). */
function fitCover(texture) {
  const { width = 1, height = 1 } = texture.image ?? {};
  const imageAspect = width / height;
  const frameAspect = PAINTING.width / PAINTING.height;
  texture.repeat.set(1, 1);
  texture.offset.set(0, 0);
  if (imageAspect > frameAspect) {
    texture.repeat.x = frameAspect / imageAspect;
    texture.offset.x = (1 - texture.repeat.x) / 2;
  } else {
    texture.repeat.y = imageAspect / frameAspect;
    texture.offset.y = (1 - texture.repeat.y) / 2;
  }
}

/**
 * One framed photo behind a velvet curtain.
 *
 * The frame border, backer, rod and curtain are drawn by GalleryBatch (instanced); this component
 * owns the logic and the one mesh that is unique per painting: the photo itself.
 *
 * - Opens when the local player is within GALLERY.proximityRadius (read from localMotion inside
 *   useFrame, so walking never re-renders React), or when either player clicks it.
 * - A click sets a shared override (held open or held closed) that is synced to the partner over
 *   Socket.io, so both see the same reveal. Overrides fall back to automatic once both walk away.
 * - The photo texture is requested only on the first reveal, decoded off the main thread, and
 *   faded in once the curtain is a third open. Until then the velvet backer is the placeholder.
 * - When the curtain is closed and the player is beyond GALLERY.releaseRadius, the texture is
 *   handed back to the LRU cache, which keeps at most GALLERY.maxResident photos loaded.
 * - Zone culling: once the frame hangs on its wall, the rooms it can be seen from are baked
 *   (world/visibility.js). From any other room its batched parts and photo aren't drawn and it
 *   takes no spotlight.
 */
export default function CurtainPhotoFrame({ photo, index }) {
  const gallery = useGallery();
  const gl = useThree((s) => s.gl);
  const { world, rapier } = useRapier();
  const group = useRef();
  const painting = useRef();
  const hitbox = useRef();

  const material = useMemo(
    () => // A print, not a mirror: matte, with a share of its own light (the emissive map is the photo again) so it reads
    // clearly from across the room whatever the lamps and the sky are doing, instead of dull and patchy.
    new MeshStandardMaterial({
      map: BLANK,
      emissive: 0xffffff,
      emissiveMap: BLANK,
      emissiveIntensity: PHOTO_GLOW,
      roughness: 0.92,
      metalness: 0,
      envMapIntensity: 0.3,
      transparent: true,
      opacity: 0,
    }),
    [],
  );

  // Configured anchor, in world space. photos.js is written at the house's authored scale.
  const configured = useMemo(() => {
    const position = new Vector3(...photo.position).multiplyScalar(MANSION_SCALE);
    const quaternion = new Quaternion().setFromEuler(new Euler(...photo.rotation));
    const normal = new Vector3(0, 0, 1).applyQuaternion(quaternion);
    return { position, quaternion, normal, back: normal.clone().negate() };
  }, [photo.position, photo.rotation]);

  // Per-frame state lives here, not in React state.
  const st = useRef({
    placed: false,
    snapped: false,
    snapTries: 0,
    near: false,
    inReach: false, // within GALLERY.resetRadius last frame
    wantOpen: false,
    open: 0,
    fade: 0,
    tex: 'idle', // idle | loading | ready | failed
    loadToken: 0,
    caption: false,
  }).current;

  const sightId = `photo:${photo.id}`;
  const place = (position) => {
    gallery.place(index, scratchMatrix.compose(position, configured.quaternion, IDENTITY_SCALE));
    group.current.position.copy(position);
    group.current.quaternion.copy(configured.quaternion);
  };

  /** Queues the visibility bake for where the frame finally hangs. */
  const registerSight = () => {
    const { position, quaternion } = group.current;
    const matrix = new Matrix4().compose(position, quaternion, IDENTITY_SCALE);
    const points = SIGHT_POINTS.map(([x, y]) => new Vector3(x, y, 0.3).applyMatrix4(matrix));
    registerTarget(sightId, points);
  };

  /** Casts from in front of the anchor toward the wall and hangs the frame on whatever it hits. */
  const snapToWall = () => {
    const origin = scratchOrigin.copy(configured.position).addScaledVector(configured.normal, SNAP_PROBE);
    const ray = new rapier.Ray(origin, configured.back);
    const hit = world.castRay(ray, SNAP_PROBE + SNAP_REACH, true, rapier.QueryFilterFlags.ONLY_FIXED);
    if (!hit) return false;
    place(origin.clone().addScaledVector(configured.back, hit.timeOfImpact - SNAP_GAP));
    return true;
  };

  const loadPhoto = () => {
    st.tex = 'loading';
    const token = ++st.loadToken;
    acquireTexture(photo.src, gl).then(
      (texture) => {
        if (token !== st.loadToken) {
          releaseTexture(photo.src); // unmounted or unloaded while fetching
          return;
        }
        fitCover(texture);
        material.map = material.emissiveMap = texture;
        st.tex = 'ready';
      },
      (err) => {
        if (token !== st.loadToken) return;
        st.tex = 'failed'; // the velvet backer stays; the curtain still works
        console.warn(`[gallery] could not load ${photo.src}`, err);
      },
    );
  };

  const unloadPhoto = () => {
    material.map = material.emissiveMap = BLANK;
    st.tex = 'idle';
    st.fade = 0;
    releaseTexture(photo.src);
  };

  const toggle = () => setCurtainOverride(photo.id, !st.wantOpen);

  useEffect(() => {
    // (Re)mounting starts from the wall again: React's dev double-run, or a spare slot taking a new photo.
    Object.assign(st, { placed: false, snapped: false, snapTries: 0, near: false, wantOpen: false, open: 0, fade: 0 });
    gallery.hitboxes[index] = hitbox.current;
    gallery.toggles[index] = toggle;
    return () => {
      gallery.hitboxes[index] = null;
      gallery.toggles[index] = null;
      gallery.clear(index);
      if (st.tex === 'ready') {
        releaseTexture(photo.src);
        material.map = material.emissiveMap = BLANK;
      }
      st.tex = 'idle';
      st.loadToken += 1; // a fetch still in flight releases itself when it lands
      unregisterTarget(sightId);
      material.dispose();
      const session = useSession.getState();
      if (session.activePhoto === photo.id) session.setActivePhoto(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gallery, index, photo.src]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1); // a stalled tab shouldn't snap the animation

    // 1. Placement: immediately at the configured anchor, then on the wall once physics can be queried.
    if (!st.placed) {
      place(configured.position);
      st.placed = true;
    }
    if (!st.snapped && ++st.snapTries >= 2) {
      if (snapToWall() || st.snapTries > SNAP_ATTEMPTS) {
        st.snapped = true;
        registerSight();
      }
    }

    // 2. Triggers.
    const anchor = gallery.anchors[index].position;
    const dist = reach(localMotion.position, anchor);
    const visible = dist < ALWAYS_DRAW || (dist < DRAW_DISTANCE && isVisible(sightId));
    gallery.setVisible(index, visible);
    if (!st.near && dist < GALLERY.proximityRadius) st.near = true;
    else if (st.near && dist > GALLERY.closeRadius) st.near = false;

    const override = curtainOverrides.get(photo.id); // undefined, true or false
    // A held curtain returns to automatic when this player walks away and the partner isn't near
    // either. Only on the way out: a curtain clicked (or synced) from afar stays held until then.
    const inReach = dist <= GALLERY.resetRadius;
    if (override !== undefined && st.inReach && !inReach) {
      const partnerDist = partner.known ? reach(partner.position, anchor) : Infinity;
      if (partnerDist > GALLERY.resetRadius) setCurtainOverride(photo.id, null);
    }
    st.inReach = inReach;
    st.wantOpen = curtainOverrides.get(photo.id) ?? st.near;

    // 3. Curtain: frame-rate-independent easing. Opening is a touch slower than closing, like heavy cloth.
    const goal = st.wantOpen ? 1 : 0;
    st.open = damp(st.open, goal, st.wantOpen ? 1.8 : 2.6, dt);
    if (Math.abs(st.open - goal) < 0.001) st.open = goal;
    gallery.setOpen(index, st.open);

    // 4. Texture lifecycle: load on first reveal, give it back when closed and far away.
    if (st.wantOpen && st.tex === 'idle') loadPhoto();
    if (st.tex === 'ready' && !st.wantOpen && st.open === 0 && dist > GALLERY.releaseRadius) unloadPhoto();

    // 5. Fade the photo in once the curtain is a third open; drawn only while partly visible and near.
    const fadeGoal = st.tex === 'ready' && st.open > 0.35 ? 1 : 0;
    st.fade = damp(st.fade, fadeGoal, 3, dt);
    if (Math.abs(st.fade - fadeGoal) < 0.002) st.fade = fadeGoal;
    material.opacity = st.fade;
    material.transparent = st.fade < 1; // fully faded-in paintings render in the opaque pass
    painting.current.visible = st.fade > 0 && visible;

    // 6. Caption: React only hears about it when it changes.
    const caption = st.near && st.wantOpen && st.tex === 'ready';
    if (caption !== st.caption) {
      st.caption = caption;
      const session = useSession.getState();
      if (caption) session.setActivePhoto(photo.id);
      else if (session.activePhoto === photo.id) session.setActivePhoto(null);
    }
  });

  return (
    <group ref={group}>
      <mesh ref={painting} geometry={paintingGeometry} material={material} position={[0, 0, PAINTING.z]} visible={false} />
      <mesh
        ref={hitbox}
        geometry={hitGeometry}
        material={hitMaterial}
        position={[0, CURTAIN.rodY - CURTAIN.height / 2, CURTAIN.z + 0.02]}
        onClick={(e) => {
          if (document.pointerLockElement || !gallery.visible[index]) return; // while looking around, the centre-screen click handles it
          e.stopPropagation();
          toggle();
        }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = '')}
      />
    </group>
  );
}
