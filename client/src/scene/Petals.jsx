import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three';
import { COURTYARD } from '../world/canopy';
import { usePerf } from '../state/perf';
import { keepOutOfReflections } from '../world/layers';

// A few rose petals drifting down through the courtyard's light, turning as they fall, and starting again from
// under the roof when they reach the floor. One Points object (one draw call); the petal's shape and its tumble
// are drawn in the fragment shader, so there is no texture. Skipped in the low tier.

const COUNT = 140;
const FALL = 0.32; // metres a second

const VERTEX = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uScale;
  varying float vSpin;
  varying float vTilt;
  varying float vShade;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = 0.06 * uScale / -mv.z;
    vSpin = uTime * (0.6 + aSeed) + aSeed * 40.0;
    vTilt = 0.35 + 0.65 * abs(sin(uTime * (0.8 + aSeed * 0.7) + aSeed * 17.0)); // seen edge-on, then face-on
    vShade = fract(aSeed * 7.31);
  }
`;
const FRAGMENT = /* glsl */ `
  varying float vSpin;
  varying float vTilt;
  varying float vShade;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vSpin), s = sin(vSpin);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    p.x /= vTilt;
    // A petal: an egg shape, rounder at the top, with a small notch.
    float r = length(vec2(p.x * 1.6, p.y + 0.08 * p.y * p.y * 8.0));
    float notch = smoothstep(0.03, 0.0, abs(p.x)) * step(0.36, p.y);
    float a = smoothstep(0.42, 0.36, r) * (1.0 - notch);
    if (a < 0.05) discard;
    vec3 blush = mix(vec3(0.95, 0.42, 0.52), vec3(0.98, 0.72, 0.76), vShade);
    vec3 col = mix(blush * 0.7, blush, smoothstep(-0.4, 0.3, p.y)); // deeper toward the base
    gl_FragColor = vec4(col * (0.75 + 0.25 * vTilt), a);
  }
`;

export default function Petals() {
  const tier = usePerf((s) => s.tier);
  const { gl, camera } = useThree();

  const petals = useMemo(() => {
    const geometry = new BufferGeometry();
    const position = new Float32Array(COUNT * 3);
    const seed = new Float32Array(COUNT);
    const spot = () => [COURTYARD.x0 + Math.random() * (COURTYARD.x1 - COURTYARD.x0), COURTYARD.zSouth + 0.3 + Math.random() * (COURTYARD.zNorth - COURTYARD.zSouth - 0.6)];
    for (let i = 0; i < COUNT; i++) {
      const [x, z] = spot();
      position.set([x, Math.random() * COURTYARD.eaveY, z], i * 3);
      seed[i] = Math.random();
    }
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 1));
    const material = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 500 } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    keepOutOfReflections(points);
    return { geometry, material, points, spot };
  }, []);

  useEffect(() => () => {
    petals.geometry.dispose();
    petals.material.dispose();
  }, [petals]);

  useFrame((state, rawDt) => {
    if (tier === 'low') return;
    const dt = Math.min(rawDt, 0.1);
    const t = state.clock.elapsedTime;
    const pos = petals.geometry.attributes.position;
    const seed = petals.geometry.attributes.aSeed;
    for (let i = 0; i < COUNT; i++) {
      const k = seed.getX(i);
      let y = pos.getY(i) - FALL * (0.7 + 0.6 * k) * dt;
      let x = pos.getX(i) + Math.sin(t * (0.5 + k) + k * 30) * 0.35 * dt + 0.12 * dt; // a light draught along the hall
      let z = pos.getZ(i) + Math.cos(t * (0.4 + k * 0.8) + k * 50) * 0.3 * dt;
      if (y < 0.03 || x > COURTYARD.x1) {
        [x, z] = petals.spot();
        y = COURTYARD.eaveY - 0.5;
      }
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
    petals.material.uniforms.uTime.value = t;
    petals.material.uniforms.uScale.value = gl.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
  });

  return tier === 'low' ? null : <primitive object={petals.points} />;
}
