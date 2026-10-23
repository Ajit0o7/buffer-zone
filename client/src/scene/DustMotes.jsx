import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three';
import { MANSION_SCALE } from '../world/config';
import { usePerf } from '../state/perf';

// Warm dust drifting through the nave. All the motion is in the vertex shader (each speck rises slowly,
// wanders a little, and wraps round at the top), so it costs one draw call and no JavaScript per frame.
// Specks are brightest inside a few slanted bands, which read as shafts of sunlight from the arcades;
// they fade out with distance so they never clutter the far end of the hall.

const COUNT = 700;
const BOX = { x: 14 * MANSION_SCALE, z: 4.2 * MANSION_SCALE, height: 10 };
const FADE_START = 6;
const FADE_END = 26;

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  attribute vec4 aSeed; // x phase, y rise speed, z size, w which band it lives in
  varying float vAlpha;

  void main() {
    float t = uTime;
    vec3 p = position;
    p.y = mod(position.y + t * aSeed.y, ${BOX.height.toFixed(1)});
    p.x += sin(t * 0.21 + aSeed.x * 6.28) * 0.5 + sin(t * 0.57 + aSeed.x * 13.0) * 0.12;
    p.z += cos(t * 0.17 + aSeed.x * 9.0) * 0.4;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);

    // Slanted bands of light: lit where a diagonal coordinate falls in a narrow window, one every 5 m.
    float diag = p.x * 0.8 + p.y * 0.6;
    float band = smoothstep(0.55, 0.9, 0.5 + 0.5 * sin(diag * 1.2566 + aSeed.w * 0.5));
    float twinkle = 0.65 + 0.35 * sin(t * 1.3 + aSeed.x * 40.0);
    float dist = -mv.z;
    float fade = 1.0 - smoothstep(${FADE_START.toFixed(1)}, ${FADE_END.toFixed(1)}, dist);
    float nearFade = smoothstep(1.2, 3.5, dist); // not a blob across the lens when one drifts past the camera
    // The ends of the column fade, so wrapping round at the top and bottom never pops.
    float column = smoothstep(0.0, 1.0, p.y) * (1.0 - smoothstep(${(BOX.height - 1.5).toFixed(1)}, ${BOX.height.toFixed(1)}, p.y));
    vAlpha = (0.12 + 0.88 * band) * twinkle * fade * nearFade * column;

    gl_PointSize = aSeed.z * uPixelRatio * 90.0 / max(dist, 0.5);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float soft = 1.0 - smoothstep(0.0, 1.0, d);
    gl_FragColor = vec4(1.0, 0.86, 0.62, soft * soft * vAlpha * 0.55);
  }
`;

export default function DustMotes() {
  const tier = usePerf((s) => s.tier);

  const points = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const seeds = new Float32Array(COUNT * 4);
    let s = 7;
    const rand = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < COUNT; i++) {
      positions.set([(rand() * 2 - 1) * BOX.x, rand() * BOX.height, (rand() * 2 - 1) * BOX.z], i * 3);
      seeds.set([rand(), 0.025 + rand() * 0.05, 0.35 + rand() * 0.6, rand() * 12], i * 4);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 4));
    const material = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const object = new Points(geometry, material);
    object.frustumCulled = false; // the shader moves the points, so their stored bounds mean nothing
    return object;
  }, []);

  useEffect(
    () => () => {
      points.geometry.dispose();
      points.material.dispose();
    },
    [points],
  );

  useFrame((state) => {
    points.material.uniforms.uTime.value = state.clock.elapsedTime;
    points.material.uniforms.uPixelRatio.value = state.gl.getPixelRatio();
  });

  if (tier === 'low') return null; // the cheap tier skips decoration
  return <primitive object={points} />;
}
