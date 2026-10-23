import { useEffect, useMemo } from 'react';
import { MeshReflectorMaterial } from '@react-three/drei';
import { BoxGeometry, CanvasTexture, Color, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { usePerf } from '../state/perf';

// The courtyard floor, laid in polished cream marble over the house's weathered stone: veined slabs with fine
// joints, framed by a dark border inlay, and glossy enough to mirror the lanterns, the stair's red runner, the
// columns and the two of you. Only the open courtyard gets it; the aisles keep their old stone.
//
// Reflections are real (a mirrored render of the scene, blurred by roughness) in the high and cinematic tiers;
// the medium and low tiers keep the same marble with environment gloss only, since the mirror pass redraws the scene.

const AREA = { x0: -16.9, x1: 15.5, z0: -3.0, z1: 2.1 }; // inside the colonnades' plinths, wall to wall
const LIFT = 0.006; // above the old floor: clears it without a visible step
const SLAB = 1.5; // metres; the texture holds 2 × 2 slabs
const BORDER = 0.16; // the dark inlay round the edge

/** Tileable value noise on a `period`-cell lattice. */
function makeNoise(period, seed) {
  const grid = new Float32Array(period * period);
  let s = seed;
  for (let i = 0; i < grid.length; i++) {
    s = (s * 16807) % 2147483647;
    grid[i] = s / 2147483647;
  }
  const at = (x, y) => grid[((y % period) + period) % period * period + (((x % period) + period) % period)];
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * u;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * u;
    return a + (b - a) * v;
  };
}

/** Cream marble with grey-gold veins, 2 × 2 slabs with joints, as a tileable canvas texture. */
function marbleTexture(size = 1024) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const img = g.createImageData(size, size);
  const octaves = [makeNoise(4, 11), makeNoise(8, 23), makeNoise(16, 37), makeNoise(32, 51), makeNoise(64, 71)];
  const fbm = (x, y) => {
    let v = 0;
    let a = 0.5;
    for (let k = 0; k < octaves.length; k++) {
      const f = 4 << k; // lattice cells across the texture, matching each noise's period
      v += a * octaves[k]((x * f) / size, (y * f) / size);
      a *= 0.5;
    }
    return v;
  };
  const base = [200, 186, 166];
  const vein = [104, 92, 80];
  const gold = [176, 140, 84];
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Each slab is cut from a different part of the block: offset the pattern per slab.
      const slab = (x < half ? 0 : 1) + (y < half ? 0 : 2);
      const sx = x + slab * 137;
      const sy = y + slab * 251;
      const cloud = fbm(sx, sy);
      const turb = fbm(sx * 1.7 + 400, sy * 1.7 + 900);
      // Veins: where a warped diagonal wave crosses zero.
      const wave = Math.sin(((sx + sy * 0.6) / size) * Math.PI * 4 + turb * 9 + slab);
      const main = Math.max(0, 1 - Math.abs(wave) / 0.07) ** 1.5 * 0.85;
      const fine = Math.max(0, 1 - Math.abs(Math.sin((sx * 0.9 - sy) / size * Math.PI * 10 + cloud * 14)) / 0.02) * 0.35;
      const shade = 0.9 + 0.22 * (cloud - 0.5);
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        let v = base[c] * shade;
        v += (vein[c] - v) * Math.min(1, main);
        v += (gold[c] - v) * fine;
        img.data[i + c] = v;
      }
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Joints between the slabs.
  g.strokeStyle = 'rgba(120, 104, 86, 0.55)';
  g.lineWidth = 2;
  for (const p of [0, half, size]) {
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, size);
    g.moveTo(0, p);
    g.lineTo(size, p);
    g.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

export default function MarbleFloor() {
  const tier = usePerf((s) => s.tier);
  const width = AREA.x1 - AREA.x0;
  const depth = AREA.z1 - AREA.z0;

  const assets = useMemo(() => {
    const map = marbleTexture();
    map.repeat.set(width / (2 * SLAB), depth / (2 * SLAB));
    // The border inlay: four strips of dark green-black marble, one draw call.
    const strips = [
      new BoxGeometry(width, 0.012, BORDER).translate(0, 0, AREA.z0 + BORDER / 2),
      new BoxGeometry(width, 0.012, BORDER).translate(0, 0, AREA.z1 - BORDER / 2),
      new BoxGeometry(BORDER, 0.012, depth).translate(-width / 2 + BORDER / 2, 0, (AREA.z0 + AREA.z1) / 2),
      new BoxGeometry(BORDER, 0.012, depth).translate(width / 2 - BORDER / 2, 0, (AREA.z0 + AREA.z1) / 2),
    ];
    const border = mergeGeometries(strips);
    strips.forEach((s) => s.dispose());
    return {
      map,
      border,
      borderMaterial: new MeshStandardMaterial({ color: new Color('#16201b'), roughness: 0.12, metalness: 0.1 }),
      plain: new MeshStandardMaterial({ map, roughness: 0.2, metalness: 0, envMapIntensity: 1.1 }),
    };
  }, [width, depth]);

  useEffect(() => () => {
    assets.map.dispose();
    assets.border.dispose();
    assets.borderMaterial.dispose();
    assets.plain.dispose();
  }, [assets]);

  const mirror = tier === 'high' || tier === 'cinematic'; // medium and low: environment gloss only
  const cx = (AREA.x0 + AREA.x1) / 2;
  const cz = (AREA.z0 + AREA.z1) / 2;

  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[cx, LIFT, cz]} receiveShadow material={mirror ? undefined : assets.plain}>
        <planeGeometry args={[width, depth]} />
        {mirror && (
          <MeshReflectorMaterial
            map={assets.map}
            resolution={tier === 'cinematic' ? 1024 : 512}
            blur={[260, 80]}
            mixBlur={0.9}
            mixStrength={0.6}
            mixContrast={1.0}
            roughness={0.22}
            metalness={0}
            depthScale={0.6}
            minDepthThreshold={0.35}
            maxDepthThreshold={1.3}
            mirror={0.3}
            envMapIntensity={1.1}
          />
        )}
      </mesh>
      <mesh geometry={assets.border} material={assets.borderMaterial} position={[cx, LIFT + 0.002, 0]} receiveShadow />
    </>
  );
}
