import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Raycaster, Vector2, Vector3 } from 'three';
import GalleryBatch, { useGallery } from './GalleryBatch';
import CurtainPhotoFrame from './CurtainPhotoFrame';
import { partner } from './curtainState';
import { PHOTOS } from './photos';
import { GALLERY_CAPACITY, memoryAsPhoto } from './memorySlots';
import { memoryUrl } from './memoryNet';
import { useMemories } from '../state/memories';
import { useSession } from '../state/session';
import { localMotion, remote } from '../world/shared';
import { GALLERY, INTERP_DELAY_MS } from '../world/config';

/**
 * A fixed pool of spotlights that follow the most-open paintings near the player. Every light in a
 * scene adds cost to every lit pixel, and changing the light count recompiles shaders, so instead of
 * one spotlight per painting there are always exactly GALLERY.spotlights, dimmed to zero when idle.
 */
function SpotlightPool() {
  const gallery = useGallery();
  const lights = useRef([]);
  const targets = useRef([]);
  const picks = useMemo(() => new Array(GALLERY.spotlights).fill(-1), []);
  const scores = useMemo(() => new Float32Array(GALLERY.spotlights), []);

  useEffect(() => {
    lights.current.forEach((light, k) => (light.target = targets.current[k]));
  }, []);

  useFrame(() => {
    picks.fill(-1);
    scores.fill(0);
    // Keep the N best: open amount, weighted toward paintings close to the player.
    for (let i = 0; i < gallery.count; i++) {
      const open = gallery.open[i];
      const anchor = gallery.anchors[i];
      if (open < 0.02 || !anchor.placed || !gallery.visible[i]) continue; // closed, or zone-culled
      const score = open / (1 + anchor.position.distanceTo(localMotion.position) * 0.1);
      for (let k = 0; k < picks.length; k++) {
        if (score > scores[k]) {
          picks.copyWithin(k + 1, k);
          scores.copyWithin(k + 1, k);
          picks[k] = i;
          scores[k] = score;
          break;
        }
      }
    }
    for (let k = 0; k < picks.length; k++) {
      const light = lights.current[k];
      const i = picks[k];
      if (i < 0) {
        light.intensity = 0;
        continue;
      }
      const { position, normal } = gallery.anchors[i];
      light.position.copy(position).addScaledVector(normal, 2.2);
      light.position.y += 1.8;
      targets.current[k].position.copy(position);
      light.intensity = 45 * gallery.open[i];
    }
  });

  return Array.from({ length: GALLERY.spotlights }, (_, k) => (
    <group key={k}>
      <spotLight
        ref={(el) => (lights.current[k] = el)}
        angle={0.42}
        penumbra={0.85}
        distance={14}
        decay={2}
        intensity={0}
        color="#fff1d6"
      />
      <object3D ref={(el) => (targets.current[k] = el)} />
    </group>
  ));
}

/**
 * While the mouse is captured (pointer lock) the cursor sits at the centre of the screen, so a click
 * is resolved by casting from there. Only the curtain hitboxes are tested, never the whole house.
 */
function CenterClick() {
  const gallery = useGallery();
  const { camera, gl } = useThree();

  useEffect(() => {
    const raycaster = new Raycaster();
    raycaster.far = 12;
    const center = new Vector2(0, 0);
    const onMouseDown = (event) => {
      if (event.button !== 0 || document.pointerLockElement !== gl.domElement) return;
      raycaster.setFromCamera(center, camera);
      const hit = raycaster.intersectObjects(gallery.hitboxes.filter((h, i) => h && gallery.visible[i]), false)[0];
      if (!hit) return;
      gallery.toggles[gallery.hitboxes.indexOf(hit.object)]?.();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [gallery, camera, gl]);

  return null;
}

/** Keeps the partner's interpolated position in shared state, for releasing held curtains. */
function PartnerTracker() {
  const sample = useMemo(() => ({ position: new Vector3(), yaw: 0, speed: 0, anim: 'idle' }), []);
  useFrame(() => {
    const s = remote.sample(performance.now() - INTERP_DELAY_MS, sample);
    partner.known = s !== null;
    if (s) partner.position.copy(sample.position);
  });
  return null;
}

/**
 * The gallery: every photo in photos.js, and every memory the players have added, behind a curtain.
 * The batch is built with a spare instance for each possible memory, so adding one needs no rebuild:
 * its frame just mounts on its slot's instance. Must sit inside <Physics>, because each frame snaps
 * itself onto the nearest wall with a physics ray when the scene starts.
 */
export default function PhotoFrames({ photos = PHOTOS }) {
  const roomId = useSession((s) => s.roomId);
  const memories = useMemories((s) => s.list);
  return (
    <GalleryBatch count={GALLERY_CAPACITY}>
      {photos.map((photo, i) => (
        <CurtainPhotoFrame key={photo.id} photo={photo} index={i} />
      ))}
      {memories.map((memory) => {
        const photo = memoryAsPhoto(memory, memoryUrl(roomId, memory.id));
        return <CurtainPhotoFrame key={photo.id} photo={photo} index={photo.slot} />;
      })}
      <SpotlightPool />
      <CenterClick />
      <PartnerTracker />
    </GalleryBatch>
  );
}
