import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { createCurtainMaterial } from './curtainMaterial';
import { textureCacheStats } from './textureCache';
import { BACKER_Z, CURTAIN, FRAME, PAINTING, ROD } from './dimensions';

const GalleryContext = createContext(null);
export const useGallery = () => useContext(GalleryContext);

// Local offsets of each batched part relative to a frame's wall anchor.
const OFFSET = {
  frame: new Matrix4().makeTranslation(0, 0, FRAME.depth / 2),
  backer: new Matrix4().makeTranslation(0, 0, BACKER_Z),
  rod: new Matrix4().makeTranslation(0, CURTAIN.rodY, CURTAIN.z).multiply(new Matrix4().makeRotationZ(Math.PI / 2)),
  curtainLeft: new Matrix4().makeTranslation(0, CURTAIN.rodY, CURTAIN.z),
  curtainRight: new Matrix4().makeTranslation(0, CURTAIN.rodY, CURTAIN.z).multiply(new Matrix4().makeScale(-1, 1, 1)),
};
const HIDDEN = new Matrix4().makeScale(0, 0, 0);
const scratch = new Matrix4();

/**
 * Draws every frame border, velvet backer, brass rod and curtain half in the gallery with four
 * instanced draw calls, whatever the number of paintings. Each CurtainPhotoFrame only writes its
 * anchor matrix (once, plus once more after it snaps to the wall) and its curtain's open amount;
 * the batch turns those into instance data. Only revealed paintings add a draw call of their own.
 *
 * Context value (mutable, read in useFrame):
 *   anchors[i]  { position, normal, placed }   world-space wall anchor of painting i
 *   open[i]     current curtain opening 0..1    (written by the frame)
 *   hitboxes[i] / toggles[i]                    for centre-screen clicks while the mouse is locked
 */
export default function GalleryBatch({ count, children }) {
  const frameMesh = useRef();
  const backerMesh = useRef();
  const rodMesh = useRef();
  const curtainMesh = useRef();

  const assets = useMemo(() => {
    const half = new PlaneGeometry(CURTAIN.width / 2, CURTAIN.height, CURTAIN.segmentsX, CURTAIN.segmentsY);
    // Hang from the rod: x from the outer edge (-width/2) to the seam (0), y from 0 down to -height.
    half.translate(-CURTAIN.width / 4, -CURTAIN.height / 2, 0);
    const openAttr = new InstancedBufferAttribute(new Float32Array(count * 2), 1);
    openAttr.setUsage(DynamicDrawUsage);
    half.setAttribute('aOpen', openAttr);

    const curtain = createCurtainMaterial({ halfWidth: CURTAIN.width / 2, height: CURTAIN.height });
    return {
      openAttr,
      curtain,
      curtainGeometry: half,
      frameGeometry: new BoxGeometry(FRAME.width, FRAME.height, FRAME.depth),
      backerGeometry: new PlaneGeometry(PAINTING.width + 0.06, PAINTING.height + 0.06),
      rodGeometry: new CylinderGeometry(ROD.radius, ROD.radius, ROD.length, 12),
      gilt: new MeshStandardMaterial({ color: '#9c7a3c', metalness: 0.8, roughness: 0.35 }),
      velvet: new MeshStandardMaterial({ color: '#2a0a10', roughness: 1 }),
      brass: new MeshStandardMaterial({ color: '#b08d57', metalness: 0.9, roughness: 0.3 }),
    };
  }, [count]);

  const api = useMemo(() => {
    const anchors = Array.from({ length: count }, () => ({ position: new Vector3(), normal: new Vector3(0, 0, 1), placed: false }));
    const open = new Float32Array(count);
    let dirtyOpen = false;
    const q = new Quaternion();
    const s = new Vector3();

    return {
      count,
      anchors,
      open,
      hitboxes: new Array(count).fill(null),
      toggles: new Array(count).fill(null),

      /** Sets painting i's wall anchor (a world matrix) and moves its batched parts there. */
      place(i, matrix) {
        const a = anchors[i];
        matrix.decompose(a.position, q, s);
        a.normal.set(0, 0, 1).applyQuaternion(q);
        a.placed = true;
        frameMesh.current.setMatrixAt(i, scratch.multiplyMatrices(matrix, OFFSET.frame));
        backerMesh.current.setMatrixAt(i, scratch.multiplyMatrices(matrix, OFFSET.backer));
        rodMesh.current.setMatrixAt(i, scratch.multiplyMatrices(matrix, OFFSET.rod));
        curtainMesh.current.setMatrixAt(i * 2, scratch.multiplyMatrices(matrix, OFFSET.curtainLeft));
        curtainMesh.current.setMatrixAt(i * 2 + 1, scratch.multiplyMatrices(matrix, OFFSET.curtainRight));
        for (const mesh of [frameMesh, backerMesh, rodMesh, curtainMesh]) {
          mesh.current.instanceMatrix.needsUpdate = true;
          mesh.current.computeBoundingSphere(); // keeps frustum culling correct for the batch
        }
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
      frameMesh.current.setMatrixAt(i, HIDDEN);
      backerMesh.current.setMatrixAt(i, HIDDEN);
      rodMesh.current.setMatrixAt(i, HIDDEN);
      curtainMesh.current.setMatrixAt(i * 2, HIDDEN);
      curtainMesh.current.setMatrixAt(i * 2 + 1, HIDDEN);
    }
    for (const mesh of [frameMesh, backerMesh, rodMesh, curtainMesh]) mesh.current.instanceMatrix.needsUpdate = true;
  }, [count]);

  useEffect(() => () => {
    for (const key of ['curtainGeometry', 'frameGeometry', 'backerGeometry', 'rodGeometry']) assets[key].dispose();
    for (const m of [assets.curtain.material, assets.gilt, assets.velvet, assets.brass]) m.dispose();
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
      <instancedMesh ref={frameMesh} args={[assets.frameGeometry, assets.gilt, count]} receiveShadow />
      <instancedMesh ref={backerMesh} args={[assets.backerGeometry, assets.velvet, count]} />
      <instancedMesh ref={rodMesh} args={[assets.rodGeometry, assets.brass, count]} />
      <instancedMesh ref={curtainMesh} args={[assets.curtainGeometry, assets.curtain.material, count * 2]} />
      {children}
    </GalleryContext.Provider>
  );
}
