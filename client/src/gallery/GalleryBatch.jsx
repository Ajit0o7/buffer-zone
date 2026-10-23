import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DataTexture,
  ExtrudeGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  Matrix4,
  MeshStandardMaterial,
  NearestFilter,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  Shape,
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

// A frame's moulded gilt profile: a bevelled ring round the painting, plus corner rosettes.
const BEVEL = { size: 0.022, thickness: 0.025 };

function rect(w, h) {
  const r = new Shape();
  r.moveTo(-w / 2, -h / 2);
  r.lineTo(w / 2, -h / 2);
  r.lineTo(w / 2, h / 2);
  r.lineTo(-w / 2, h / 2);
  r.lineTo(-w / 2, -h / 2);
  return r;
}

/** A cylinder from a to b (each [x, y, z]). */
function rodBetween(a, b, radius) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const length = Math.hypot(dx, dy, dz);
  const g = new CylinderGeometry(radius, radius, length, 8);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(dx, dy, dz).normalize()));
  return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}

// The picture light: a brass hood hung from the curtain rod on a short arm, in front of the cloth, its lamp
// over the top of the frame. The glowing strip under the hood is a separate instanced mesh (it brightens as the
// curtain opens); the plaque's engraving is another (its text comes from an atlas).
const LAMP = { y: FRAME.height / 2 + 0.16, z: CURTAIN.z + 0.13, width: 0.66 };
const PLAQUE = { y: -FRAME.height / 2 - 0.14, width: 0.52, height: 0.13 };

/**
 * Everything that hangs on the wall except the cloth, as one geometry in the frame's local space
 * (origin on the wall at the centre of the painting, +Z out of the wall into the room): moulded gilt frame with
 * corner rosettes, velvet backer, brass rod with ball finials, two iron brackets holding the rod off the wall,
 * the brass picture light, and the brass plaque below the frame.
 * Curtain rings are left out on purpose: the cloth hangs from a rod pocket, which reads the same at
 * viewing distance and needs nothing to follow the gathering cloth.
 */
function mountingGeometry() {
  const rodY = CURTAIN.rodY;
  // The frame: a bevelled ring, sized so that with its bevels it spans FRAME and leaves a 1.5 cm velvet slip.
  const outline = rect(FRAME.width - 2 * BEVEL.size, FRAME.height - 2 * BEVEL.size);
  outline.holes.push(rect(PAINTING.width + 0.03 + 2 * BEVEL.size, PAINTING.height + 0.03 + 2 * BEVEL.size));
  const frame = new ExtrudeGeometry(outline, {
    depth: FRAME.depth - 2 * BEVEL.thickness,
    bevelEnabled: true,
    bevelSize: BEVEL.size,
    bevelThickness: BEVEL.thickness,
    bevelSegments: 3,
    curveSegments: 1,
  }).translate(0, 0, BEVEL.thickness);
  // A raised bead inside it, for a second step in the profile.
  const beadShape = rect(PAINTING.width + 0.075, PAINTING.height + 0.075);
  beadShape.holes.push(rect(PAINTING.width + 0.035, PAINTING.height + 0.035));
  const bead = new ExtrudeGeometry(beadShape, { depth: 0.006, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.006, bevelSegments: 2 })
    .translate(0, 0, FRAME.depth - 0.004);

  const parts = [
    finish(frame, 'gilt'),
    finish(bead, 'gilt'),
    finish(new PlaneGeometry(PAINTING.width + 0.06, PAINTING.height + 0.06).translate(0, 0, BACKER_Z), 'velvet'),
    finish(new CylinderGeometry(ROD.radius, ROD.radius, ROD.length, 12).rotateZ(Math.PI / 2).translate(0, rodY, CURTAIN.z), 'brass'),
  ];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      parts.push(finish(new SphereGeometry(0.05, 12, 8).scale(1, 1, 0.5).translate((sx * FRAME.width) / 2 - sx * 0.03, (sy * FRAME.height) / 2 - sy * 0.03, FRAME.depth), 'gilt'));
    }
  }
  for (const side of [-1, 1]) {
    parts.push(finish(new SphereGeometry(0.045, 12, 8).translate(side * (ROD.length / 2 + 0.03), rodY, CURTAIN.z), 'brass'));
    parts.push(finish(new BoxGeometry(0.03, 0.03, CURTAIN.z).translate(side * (ROD.length / 2 - 0.1), rodY, CURTAIN.z / 2), 'iron'));
    parts.push(finish(new BoxGeometry(0.07, 0.11, 0.015).translate(side * (ROD.length / 2 - 0.1), rodY, 0.008), 'iron')); // wall plate
  }
  // Picture light: arm from the rod, a half-round hood, end caps.
  parts.push(finish(rodBetween([0, rodY, CURTAIN.z + 0.02], [0, LAMP.y + 0.06, LAMP.z], 0.009), 'brass'));
  parts.push(finish(new CylinderGeometry(0.045, 0.045, LAMP.width, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 4).translate(0, LAMP.y, LAMP.z), 'brass'));
  for (const side of [-1, 1]) parts.push(finish(new CylinderGeometry(0.046, 0.046, 0.008, 16).rotateZ(Math.PI / 2).translate((side * LAMP.width) / 2, LAMP.y, LAMP.z), 'brass'));
  // The plaque: a brass plate with a bevelled edge.
  parts.push(finish(new BoxGeometry(PLAQUE.width + 0.02, PLAQUE.height + 0.02, 0.008).translate(0, PLAQUE.y, 0.006), 'brass'));

  const flat = parts.map((g) => {
    const f = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(f.attributes)) if (!['position', 'normal', 'uv'].includes(name)) f.deleteAttribute(name);
    f.clearGroups();
    return f;
  });
  const merged = mergeGeometries(flat);
  new Set([...parts, ...flat]).forEach((p) => p.dispose());
  return merged;
}

// ---- Plaques: each painting's caption and date, engraved, from one atlas texture (one draw call for all).
const ATLAS = { cols: 2, rows: 16, cellW: 512, cellH: 128 };

function wrapLines(g, text, maxWidth, maxLines) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width <= maxWidth) line = next;
    else {
      if (line) lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '…');
  return lines;
}

const plaqueDate = (iso) => {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

// Local offsets of the curtain halves relative to a frame's wall anchor.
const OFFSET = {
  lamp: new Matrix4().makeTranslation(0, LAMP.y - 0.035, LAMP.z - 0.012),
  plaque: new Matrix4().makeTranslation(0, PLAQUE.y, 0.0115),
  curtainLeft: new Matrix4().makeTranslation(0, CURTAIN.rodY, CURTAIN.z),
  curtainRight: new Matrix4().makeTranslation(0, CURTAIN.rodY, CURTAIN.z).multiply(new Matrix4().makeScale(-1, 1, 1)),
};
const HIDDEN = new Matrix4().makeScale(0, 0, 0);
const LAMP_COLOR = new Color('#ffd49a');
const lampColor = new Color();
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
  const lampMesh = useRef();
  const plaqueMesh = useRef();

  const assets = useMemo(() => {
    const half = new PlaneGeometry(CURTAIN.width / 2, CURTAIN.height, CURTAIN.segmentsX, CURTAIN.segmentsY);
    // Hang from the rod: x from the outer edge (-width/2) to the seam (0), y from 0 down to -height.
    half.translate(-CURTAIN.width / 4, -CURTAIN.height / 2, 0);
    const openAttr = new InstancedBufferAttribute(new Float32Array(count * 2), 1);
    openAttr.setUsage(DynamicDrawUsage);
    half.setAttribute('aOpen', openAttr);

    const { colorMap, ormMap } = atlasTextures();

    // Plaque atlas: a transparent canvas; the brass plate shows through around the engraving.
    const plaqueCanvas = document.createElement('canvas');
    plaqueCanvas.width = ATLAS.cols * ATLAS.cellW;
    plaqueCanvas.height = ATLAS.rows * ATLAS.cellH;
    const plaqueMap = new CanvasTexture(plaqueCanvas);
    plaqueMap.colorSpace = SRGBColorSpace;
    plaqueMap.anisotropy = 4;
    const plaqueGeometry = new PlaneGeometry(PLAQUE.width, PLAQUE.height);
    const tile = new InstancedBufferAttribute(new Float32Array(count * 2), 2);
    for (let i = 0; i < count; i++) tile.setXY(i, (i % ATLAS.cols) / ATLAS.cols, 1 - (Math.floor(i / ATLAS.cols) + 1) / ATLAS.rows);
    plaqueGeometry.setAttribute('aTile', tile);
    const plaque = new MeshStandardMaterial({ map: plaqueMap, transparent: true, roughness: 0.45, metalness: 0.6, color: '#24180a' });
    plaque.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aTile;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n  vMapUv = vMapUv * vec2(${(1 / ATLAS.cols).toFixed(6)}, ${(1 / ATLAS.rows).toFixed(6)}) + aTile;`);
    };

    return {
      plaqueCanvas,
      plaqueMap,
      plaqueGeometry,
      plaque,
      lampGeometry: new BoxGeometry(LAMP.width - 0.06, 0.012, 0.03),
      lamp: new MeshBasicMaterial({ color: '#ffffff' }),
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
      if (!mountingMesh.current || !curtainMesh.current || !lampMesh.current || !plaqueMesh.current) return; // tearing down: the meshes are already gone
      const placed = anchors[i].placed && visible[i];
      const m = matrices[i];
      mountingMesh.current.setMatrixAt(i, placed ? m : HIDDEN);
      curtainMesh.current.setMatrixAt(i * 2, placed ? scratch.multiplyMatrices(m, OFFSET.curtainLeft) : HIDDEN);
      curtainMesh.current.setMatrixAt(i * 2 + 1, placed ? scratch.multiplyMatrices(m, OFFSET.curtainRight) : HIDDEN);
      lampMesh.current.setMatrixAt(i, placed ? scratch.multiplyMatrices(m, OFFSET.lamp) : HIDDEN);
      plaqueMesh.current.setMatrixAt(i, placed ? scratch.multiplyMatrices(m, OFFSET.plaque) : HIDDEN);
      for (const mesh of [mountingMesh, curtainMesh, lampMesh, plaqueMesh]) {
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
        this.setPlaque(i, '', '');
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
        // The picture light comes up as the curtain draws back (above 1.0: it glows through the bloom pass).
        lampMesh.current?.setColorAt(i, lampColor.copy(LAMP_COLOR).multiplyScalar(0.12 + 2.6 * value));
        dirtyOpen = true;
      },

      /** Engraves painting i's plaque: its caption and date. */
      setPlaque(i, caption, date) {
        const g = assets.plaqueCanvas.getContext('2d');
        const x = (i % ATLAS.cols) * ATLAS.cellW;
        const y = Math.floor(i / ATLAS.cols) * ATLAS.cellH;
        g.clearRect(x, y, ATLAS.cellW, ATLAS.cellH);
        if (caption) {
          g.save();
          g.translate(x + ATLAS.cellW / 2, y);
          g.textAlign = 'center';
          g.fillStyle = '#ffffff';
          g.font = 'italic 600 38px "Cormorant Garamond", Georgia, serif';
          const lines = wrapLines(g, caption, ATLAS.cellW - 44, 2);
          const top = lines.length > 1 ? 42 : 60;
          lines.forEach((line, k) => g.fillText(line, 0, top + k * 36));
          g.font = '700 22px "Cormorant Garamond", Georgia, serif';
          const when = plaqueDate(date).toUpperCase();
          g.fillText(when.split('').join(String.fromCharCode(8202)), 0, ATLAS.cellH - 14);
          g.restore();
        }
        assets.plaqueMap.needsUpdate = true;
      },

      flush() {
        if (!dirtyOpen) return;
        assets.openAttr.needsUpdate = true;
        if (lampMesh.current?.instanceColor) lampMesh.current.instanceColor.needsUpdate = true;
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
      lampMesh.current.setMatrixAt(i, HIDDEN);
      plaqueMesh.current.setMatrixAt(i, HIDDEN);
      lampMesh.current.setColorAt(i, lampColor.copy(LAMP_COLOR).multiplyScalar(0.12));
    }
    for (const mesh of [mountingMesh, curtainMesh, lampMesh, plaqueMesh]) mesh.current.instanceMatrix.needsUpdate = true;
    lampMesh.current.instanceColor.needsUpdate = true;
  }, [count]);

  useEffect(() => () => {
    assets.curtainGeometry.dispose();
    assets.mountingGeometry.dispose();
    for (const d of [assets.curtain.material, assets.mounting, assets.colorMap, assets.ormMap, assets.plaqueMap, assets.plaqueGeometry, assets.plaque, assets.lampGeometry, assets.lamp]) d.dispose();
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
      <instancedMesh ref={lampMesh} args={[assets.lampGeometry, assets.lamp, count]} />
      <instancedMesh ref={plaqueMesh} args={[assets.plaqueGeometry, assets.plaque, count]} />
      {children}
    </GalleryContext.Provider>
  );
}
