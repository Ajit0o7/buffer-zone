import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, CanvasTexture, Points, ShaderMaterial, SRGBColorSpace } from 'three';
import { heartBursts } from '../world/reactions';

// Hearts that float up from an avatar when it blows a kiss or makes a heart (avatar/couplePose.js). One
// THREE.Points with a fixed pool: any number of hearts is a single draw call and nothing is allocated per frame.

const POOL = 96;
const LIFE = 2.4; // seconds
const RISE = 0.55; // m/s

function heartTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.translate(size / 2, size * 0.56);
  g.scale(size * 0.0095, -size * 0.0095);
  g.beginPath();
  g.moveTo(0, -38);
  g.bezierCurveTo(-8, -30, -46, -8, -46, 18);
  g.bezierCurveTo(-46, 38, -24, 46, 0, 26);
  g.bezierCurveTo(24, 46, 46, 38, 46, 18);
  g.bezierCurveTo(46, -8, 8, -30, 0, -38);
  g.closePath();
  const fill = g.createRadialGradient(-14, 22, 4, 0, 6, 54);
  fill.addColorStop(0, '#ff9ab5');
  fill.addColorStop(1, '#e8264f');
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = '#ffd7e0';
  g.stroke();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

const VERTEX = /* glsl */ `
  attribute float aAge;      // 0..1 of its life, or -1 when unused
  attribute float aSize;
  uniform float uScale;      // pixels per metre at distance 1
  varying float vFade;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float grow = smoothstep(0.0, 0.12, aAge);       // pops in...
    vFade = aAge < 0.0 ? 0.0 : grow * (1.0 - smoothstep(0.65, 1.0, aAge)); // ...and thins out
    gl_PointSize = aAge < 0.0 ? 0.0 : aSize * (0.6 + 0.4 * grow) * uScale / -mv.z;
  }
`;
const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  varying float vFade;
  void main() {
    vec4 c = texture2D(uMap, gl_PointCoord);
    if (c.a * vFade < 0.02) discard;
    gl_FragColor = vec4(c.rgb * 1.25, c.a * vFade);
  }
`;

export default function Reactions() {
  const { gl, camera } = useThree();
  const assets = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(POOL * 3), 3));
    geometry.setAttribute('aAge', new BufferAttribute(new Float32Array(POOL).fill(-1), 1));
    geometry.setAttribute('aSize', new BufferAttribute(new Float32Array(POOL), 1));
    const map = heartTexture();
    const material = new ShaderMaterial({
      uniforms: { uMap: { value: map }, uScale: { value: 400 } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false; // the pool spans wherever the hearts happen to be
    // Per-heart simulation state, parallel to the attributes.
    const sim = {
      life: new Float32Array(POOL).fill(-1),
      vx: new Float32Array(POOL),
      vz: new Float32Array(POOL),
      phase: new Float32Array(POOL),
      next: 0,
    };
    return { geometry, material, map, points, sim };
  }, []);

  useEffect(() => () => {
    assets.geometry.dispose();
    assets.material.dispose();
    assets.map.dispose();
  }, [assets]);

  // Development only: lets tests count live hearts.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__hearts = () => Array.from(assets.sim.life).filter((l) => l >= 0).length;
    return () => delete window.__hearts;
  }, [assets]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const { geometry, material, sim } = assets;
    const pos = geometry.attributes.position;
    const age = geometry.attributes.aAge;
    const size = geometry.attributes.aSize;

    // New hearts, each a little apart from its neighbours.
    while (heartBursts.length) {
      const burst = heartBursts.shift();
      for (let n = 0; n < burst.count; n++) {
        const i = sim.next;
        sim.next = (sim.next + 1) % POOL;
        pos.setXYZ(i, burst.x + (Math.random() - 0.5) * 0.35, burst.y + Math.random() * 0.15, burst.z + (Math.random() - 0.5) * 0.35);
        sim.life[i] = 0;
        sim.vx[i] = (Math.random() - 0.5) * 0.25;
        sim.vz[i] = (Math.random() - 0.5) * 0.25;
        sim.phase[i] = Math.random() * 6.28;
        size.setX(i, 0.17 + Math.random() * 0.13);
      }
    }

    for (let i = 0; i < POOL; i++) {
      if (sim.life[i] < 0) continue;
      sim.life[i] += dt;
      const a = sim.life[i] / LIFE;
      if (a >= 1) {
        sim.life[i] = -1;
        age.setX(i, -1);
        continue;
      }
      age.setX(i, a);
      sway(pos, i, sim, dt);
    }
    pos.needsUpdate = true;
    age.needsUpdate = true;
    size.needsUpdate = true;

    // Pixels per metre at distance 1: the drawing buffer's height over the view's height at that distance.
    material.uniforms.uScale.value = gl.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
  });

  return <primitive object={assets.points} />;
}

function sway(pos, i, sim, dt) {
  const t = sim.life[i];
  pos.setXYZ(
    i,
    pos.getX(i) + (sim.vx[i] + Math.sin(t * 2.4 + sim.phase[i]) * 0.12) * dt,
    pos.getY(i) + RISE * dt,
    pos.getZ(i) + sim.vz[i] * dt,
  );
}
