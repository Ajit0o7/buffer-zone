import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, CylinderGeometry, DoubleSide, Mesh, Quaternion, ShaderMaterial, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SUN } from '../world/config';
import { COURTYARD } from '../world/canopy';
import { usePerf } from '../state/perf';

// Sunbeams: soft shafts of golden light slanting in through the glass roof and down the courtyard, with dust
// drifting in them. Not real volumetrics (that would ray-march every pixel): each beam is an open tube along the
// sun's direction, drawn additively and brightest where you look across its middle, so it reads as a column of lit
// haze. All beams are one mesh and one draw call; the house's walls and stair hide them through the depth test.

// Where each beam enters under the roof: x along the courtyard, z across it, its radius and strength.
const BEAMS = [
  { x: -11.2, z: 1.1, r: 0.9, k: 1.0 },
  { x: -9.3, z: -0.6, r: 0.55, k: 0.7 },
  { x: -7.6, z: 0.5, r: 1.1, k: 0.9 },
  { x: -5.2, z: -1.5, r: 0.7, k: 0.75 },
  { x: -3.4, z: 1.2, r: 0.8, k: 0.65 },
  { x: -1.0, z: -0.3, r: 1.0, k: 0.6 },
];

const VERTEX = /* glsl */ `
  attribute float aAlong;    // 0 where the beam enters, 1 at the floor
  attribute float aStrength;
  varying float vAlong;
  varying float vStrength;
  varying float vFacing;
  varying vec3 vWorld;
  void main() {
    vAlong = aAlong;
    vStrength = aStrength;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec3 n = normalize(mat3(modelMatrix) * normal);
    vec3 toCamera = normalize(cameraPosition - world.xyz);
    vFacing = abs(dot(n, toCamera)); // 1 across the middle of the beam, 0 at its silhouette
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  varying float vAlong;
  varying float vStrength;
  varying float vFacing;
  varying vec3 vWorld;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  void main() {
    float edge = pow(vFacing, 1.5);
    float along = smoothstep(0.0, 0.08, vAlong) * (1.0 - smoothstep(0.7, 1.0, vAlong)) * (1.0 - 0.45 * vAlong);
    // Slowly drifting haze: a few broad bands moving down the beam.
    float haze = 0.75 + 0.25 * sin(vWorld.x * 0.9 + vWorld.y * 1.3 - uTime * 0.35) * sin(vWorld.z * 1.7 + uTime * 0.21);
    // Dust: sparse glints that drift.
    vec3 cell = floor(vWorld * 9.0 + vec3(0.0, uTime * 0.6, uTime * 0.2));
    float glint = step(0.996, hash(cell)) * 2.5;
    float a = edge * along * haze * vStrength * uLevel;
    gl_FragColor = vec4(vec3(1.0, 0.72, 0.42) * a * (0.2 + 0.08 * glint), 1.0);
  }
`;

export default function LightShafts() {
  const tier = usePerf((s) => s.tier);

  const mesh = useMemo(() => {
    const down = SUN.direction.clone().negate(); // the way the light travels
    const parts = BEAMS.map((b) => {
      const top = new Vector3(b.x, COURTYARD.eaveY - 0.2, b.z);
      const length = top.y / -down.y; // to the floor
      const g = new CylinderGeometry(b.r, b.r * 1.35, length, 20, 12, true); // widens a little as it falls
      // Along-beam coordinate: CylinderGeometry's v runs 1 at the top to 0 at the bottom.
      const uv = g.attributes.uv;
      const along = new Float32Array(uv.count);
      const strength = new Float32Array(uv.count).fill(b.k);
      for (let i = 0; i < uv.count; i++) along[i] = 1 - uv.getY(i);
      g.setAttribute('aAlong', new BufferAttribute(along, 1));
      g.setAttribute('aStrength', new BufferAttribute(strength, 1));
      // Point the cylinder's axis (+y) back toward the sun and put its top at the entry point.
      g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), SUN.direction));
      g.translate(...top.clone().addScaledVector(down, length / 2).toArray());
      return g;
    });
    const geometry = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    const material = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLevel: { value: 1 } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide, // the far wall of the tube too: light seen through light
    });
    const m = new Mesh(geometry, material);
    m.renderOrder = 20; // after the glass
    m.frustumCulled = false;
    return m;
  }, []);

  useEffect(() => () => {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }, [mesh]);

  useFrame((state) => {
    mesh.material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  // The cheapest tier skips them: large additive surfaces cost fill rate.
  return tier === 'low' ? null : <primitive object={mesh} />;
}
