import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  CylinderGeometry,
  DataTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  Matrix4,
  MeshStandardMaterial,
  NearestFilter,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createCurtainMaterial } from './curtainMaterial';
import { textureCacheStats } from './textureCache';
import { BACKER_Z, CURTAIN, FRAME, PAINTING, ROD } from './dimensions';

const GalleryContext = createContext(null);
export const useGallery = () => useContext(GalleryContext);

// The mounting's materials, as texels of a tiny atlas: colour in one texture, roughness (G) and
// metalness (B) in another, both read through the part's UVs. That's what lets differently
// finished parts (gilt, velvet, brass, iron) share one mesh, one material and one draw call.
const FINISHES = [
  { name: 'gilt', color: [156, 122, 60], roughness: 0.35, metalness: 0.8 },
  { name: 'velvet', color: [42, 10, 16], roughness: 1, metalness: 0 },
  { name: 'brass', color: [176, 141, 87], roughness: 0.3, metalness: 0.9 },
  { name: 'iron', color: [43, 38, 34], roughness: 0.55, metalness: 0.6 },
];
const FINISH = Object.fromEntries(FINISHES.map((f, i) => [f.name, i]));

function atlasTextures() {
  const color = new Uint8Array(FINISHES.length * 4);
  const orm = new Uint8Array(FINISHES.length * 4);
  FINISHES.forEach((f, i) => {
    color.set([...f.color, 255], i * 4);
    orm.set([255, Math.round(f.roughness * 255), Math.round(f.metalness * 255), 255], i * 4);
  });
  const make = (data) => {
    const t = new DataTexture(data, FINISHES.length, 1, RGBAFormat);
    t.magFilter = NearestFilter;
    t.minFilter = NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  const colorMap = make(color);
  colorMap.colorSpace = SRGBColorSpace;
  return { colorMap, ormMap: make(orm) };
}

/** Points every UV of a part at the centre of its finish's texel. */
function finish(geometry, name) {
  const u = (FINISH[name] + 0.5) / FINISHES.length;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, 0.5);
  return geometry;
}

/**
 * Everything that hangs on the wall except the cloth, as one geometry in the frame's local space
 * (origin on the wall at the centre of the painting, +Z out of the wall): gilt frame, velvet backer,
 * brass rod with ball finials, and two iron brackets holding the rod off the wall.
 * Curtain rings are left out on purpose: the cloth hangs from a rod pocket, which reads the same at
 * viewing distance and needs nothing to follow the gathering cloth.
 */
function mountingGeometry() {
  const rodY = CURTAIN.rodY;
  const parts = [
    finish(new BoxGeometry(FRAME.width, FRAME.height, FRAME.depth).translate(0, 0, FRAME.depth / 2), 'gilt'),
    finish(new PlaneGeometry(PAINTING.width + 0.06, PAINTING.height + 0.06).translate(0, 0, BACKER_Z), 'velvet'),
    finish(new CylinderGeometry(ROD.radius, ROD.radius, ROD.length, 12).rotateZ(Math.PI / 2).translate(0, rodY, CURTAIN.z), 'brass'),
  ];
  for (const side of [-1, 1]) {
    parts.push(finish(new SphereGeometry(0.045, 12, 8).translate(side * (ROD.length / 2 + 0.03), rodY, CURTAIN.z), 'brass'));
    parts.push(finish(new BoxGeometry(0.03, 0.03, CURTAIN.z).translate(side * (ROD.length / 2 - 0.1), rodY, CURTAIN.z / 2), 'iron'));
    parts.push(finish(new BoxGeometry(0.07, 0.11, 0.015).translate(side * (ROD.length / 2 - 0.1), rodY, 0.008), 'iron')); // wall plate
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

// Local offsets of the curtain halves relative to a frame's wall anchor.
const OFFSET = {
  curtainLeft: new Matrix4().makeTranslation(0, CURTAIN.rodY, CURTAIN.z),
  curtainRight: new Matrix4().makeTranslation(0, CURTAIN.rodY, CURTAIN.z).multiply(new Matrix4().makeScale(-1, 1, 1)),
};
const HIDDEN = new Matrix4().makeScale(0, 0, 0);
const scratch = new Matrix4();

/**
 * Draws every painting's mounting and curtains with two instanced draw calls, whatever the number of
 * paintings: one for the merged mounting (frame, backer, rod, finials, brackets), one for the curtain
 * halves. Each CurtainPhotoFrame writes its anchor matrix (once, plus once more after it snaps to the
 * wall), its curtain's open amount and whether it can be seen; the batch turns those into instance
 * data. Only revealed paintings add a draw call of their own (their photo).
 *
 * Context value (mutable, read in useFrame):
 *   anchors[i]  { position, normal, placed }   world-space wall anchor of painting i
 *   open[i]     current curtain opening 0..1    (written by the frame)
 *   visible[i]  false while zone-culled         (hidden instances cost no vertex work)
 *   hitboxes[i] / toggles[i]                    for centre-screen clicks while the mouse is locked
 */
export default function GalleryBatch({ count, children }) {
  const mountingMesh = useRef();
  const curtainMesh = useRef();

  const assets = useMemo(() => {
    const half = new PlaneGeometry(CURTAIN.width / 2, CURTAIN.height, CURTAIN.segmentsX, CURTAIN.segmentsY);
    // Hang from the rod: x from the outer edge (-width/2) to the seam (0), y from 0 down to -height.
    half.translate(-CURTAIN.width / 4, -CURTAIN.height / 2, 0);
    const openAttr = new InstancedBufferAttribute(new Float32Array(count * 2), 1);
    openAttr.setUsage(DynamicDrawUsage);
    half.setAttribute('aOpen', openAttr);

    const { colorMap, ormMap } = atlasTextures();
    return {
      openAttr,
      curtain: createCurtainMaterial({ halfWidth: CURTAIN.width / 2, height: CURTAIN.height }),
      curtainGeometry: half,
      mountingGeometry: mountingGeometry(),
      colorMap,
      ormMap,
      // Roughness and metalness multiply the atlas values, so both stay at 1.
      mounting: new MeshStandardMaterial({ map: colorMap, roughnessMap: ormMap, metalnessMap: ormMap, roughness: 1, metalness: 1 }),
    };
  }, [count]);

  const api = useMemo(() => {
    const anchors = Array.from({ length: count }, () => ({ position: new Vector3(), normal: new Vector3(0, 0, 1), placed: false }));
    const matrices = Array.from({ length: count }, () => new Matrix4());
    const open = new Float32Array(count);
    const visible = new Array(count).fill(true);
    let dirtyOpen = false;
    const q = new Quaternion();
    const s = new Vector3();

    const write = (i) => {
      if (!mountingMesh.current || !curtainMesh.current) return; // tearing down: the meshes are already gone
      const placed = anchors[i].placed && visible[i];
      const m = matrices[i];
      mountingMesh.current.setMatrixAt(i, placed ? m : HIDDEN);
      curtainMesh.current.setMatrixAt(i * 2, placed ? scratch.multiplyMatrices(m, OFFSET.curtainLeft) : HIDDEN);
      curtainMesh.current.setMatrixAt(i * 2 + 1, placed ? scratch.multiplyMatrices(m, OFFSET.curtainRight) : HIDDEN);
      for (const mesh of [mountingMesh, curtainMesh]) {
        mesh.current.instanceMatrix.needsUpdate = true;
        mesh.current.computeBoundingSphere(); // keeps frustum culling correct for the batch
      }
    };

    return {
      count,
      anchors,
      open,
      visible,
      hitboxes: new Array(count).fill(null),
      toggles: new Array(count).fill(null),

      /** Sets painting i's wall anchor (a world matrix) and moves its batched parts there. */
      place(i, matrix) {
        const a = anchors[i];
        matrix.decompose(a.position, q, s);
        a.normal.set(0, 0, 1).applyQuaternion(q);
        a.placed = true;
        matrices[i].copy(matrix);
        write(i);
      },

      /** Takes painting i off the wall (its memory was removed): the instance goes back to being spare. */
      clear(i) {
        anchors[i].placed = false;
        visible[i] = true;
        open[i] = 0;
        assets.openAttr.array[i * 2] = 0;
        assets.openAttr.array[i * 2 + 1] = 0;
        dirtyOpen = true;
        write(i);
      },

      /** Shows or hides painting i's batched parts (zone culling). */
      setVisible(i, value) {
        if (visible[i] === value) return;
        visible[i] = value;
        write(i);
      },

      /** Writes painting i's curtain opening; uploaded once per frame for all curtains together. */
      setOpen(i, value) {
        if (open[i] === value) return;
        open[i] = value;
        assets.openAttr.array[i * 2] = value;
        assets.openAttr.array[i * 2 + 1] = value;
        dirtyOpen = true;
      },

      flush() {
        if (!dirtyOpen) return;
        assets.openAttr.needsUpdate = true;
        dirtyOpen = false;
      },
    };
  }, [count, assets]);

  // Until a frame places itself, its instances are collapsed so nothing flashes at the origin.
  useLayoutEffect(() => {
    for (let i = 0; i < count; i++) {
      mountingMesh.current.setMatrixAt(i, HIDDEN);
      curtainMesh.current.setMatrixAt(i * 2, HIDDEN);
      curtainMesh.current.setMatrixAt(i * 2 + 1, HIDDEN);
    }
    for (const mesh of [mountingMesh, curtainMesh]) mesh.current.instanceMatrix.needsUpdate = true;
  }, [count]);

  useEffect(() => () => {
    assets.curtainGeometry.dispose();
    assets.mountingGeometry.dispose();
    for (const d of [assets.curtain.material, assets.mounting, assets.colorMap, assets.ormMap]) d.dispose();
  }, [assets]);

  // Development only: lets tests and the console open curtains and read VRAM use.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__gallery = { api, stats: textureCacheStats };
    return () => delete window.__gallery;
  }, [api]);

  useFrame((state) => {
    assets.curtain.uniforms.uTime.value = state.clock.elapsedTime;
    api.flush();
  });

  return (
    <GalleryContext.Provider value={api}>
      <instancedMesh ref={mountingMesh} args={[assets.mountingGeometry, assets.mounting, count]} receiveShadow />
      <instancedMesh ref={curtainMesh} args={[assets.curtainGeometry, assets.curtain.material, count * 2]} />
      {children}
    </GalleryContext.Provider>
  );
}
