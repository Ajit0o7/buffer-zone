import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial, Sphere, Vector3 } from 'three';
import { FALLS, POOLS } from './geometry';

// Spray where the streams land: droplets thrown up and out, and a little mist drifting off the basin.
// One THREE.Points with a fixed pool; every particle's motion is computed in the vertex shader from the
// clock and its seed (a fresh random path on each cycle), so it costs one draw call and no JavaScript per frame.

const DROPLETS = 520;
const MIST = 70;
const TAU = Math.PI * 2;

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uScale;   // pixels per metre at distance 1
  attribute vec4 aSeed;   // x phase, y cycles per second, z kind (0 droplet, 1 mist), w size (m)
  varying float vAlpha;
  varying float vKind;
  float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  void main() {
    float cycle = uTime * aSeed.y + aSeed.x;
    float n = floor(cycle);
    float life = fract(cycle);
    float r1 = h11(n * 1.37 + aSeed.x * 91.7);
    float r2 = h11(n * 3.11 + aSeed.x * 37.3);
    float r3 = h11(n * 5.71 + aSeed.x * 13.9);
    vec3 p = position;
    if (aSeed.z < 0.5) {
      // Thrown from the landing point: up 0.3-1.1 m/s, out 0.1-0.5 m/s, then back down into the water.
      float t = life / aSeed.y;
      float angle = r1 * 6.2831853;
      float out_ = 0.1 + 0.4 * r2;
      float up = 0.3 + 0.8 * r3 * r3;
      p.xz += vec2(r2 - 0.5, r3 - 0.5) * 0.07;
      p += vec3(cos(angle) * out_ * t, up * t - 4.905 * t * t, sin(angle) * out_ * t);
      vAlpha = step(position.y, p.y) * (1.0 - life * 0.6);
    } else {
      // Mist: rises slowly and drifts, fading in and out.
      p += vec3(sin(life * 2.0 + r1 * 6.28) * 0.12 + (r2 - 0.5) * 0.3, life * 0.32, cos(life * 1.7 + r3 * 6.28) * 0.12 + (r3 - 0.5) * 0.3);
      vAlpha = sin(life * 3.14159);
    }
    vKind = aSeed.z;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = aSeed.w * uScale / max(-mv.z, 0.3);
    // Sub-pixel droplets: keep them a pixel and a half wide and dim them instead, so they don't shimmer.
    vAlpha *= min(1.0, size / 1.5);
    gl_PointSize = max(size, 1.5);
  }
`;

const FRAGMENT = /* glsl */ `
  varying float vAlpha;
  varying float vKind;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float soft = vKind < 0.5 ? 1.0 - smoothstep(0.35, 1.0, d) : pow(1.0 - smoothstep(0.0, 1.0, d), 2.0);
    float a = soft * vAlpha * (vKind < 0.5 ? 0.55 : 0.05);
    if (a < 0.003) discard;
    gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * a, 1.0);
  }
`;

/** Builds the spray. Returns the Points; update `material.uniforms.uTime` and `uScale` each frame. */
export function createSplash(time) {
  let s = 11;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const count = DROPLETS + MIST;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 4);
  // Droplets go where the falls land, more of them under the bigger falls.
  const sources = [
    { fall: FALLS[0], y: POOLS.basin.y, share: 0.55 },
    { fall: FALLS[1], y: POOLS.lower.y, share: 0.32 },
    { fall: FALLS[2], y: POOLS.upper.y, share: 0.13 },
  ];
  for (let i = 0; i < count; i++) {
    const mist = i >= DROPLETS;
    let pick = rand();
    const source = mist ? sources[0] : sources.find((src) => (pick -= src.share) < 0) ?? sources[0];
    const { streams, landRadius } = source.fall;
    // On a stream's centre line (the same angles the falls and water shaders use), or anywhere round a bell.
    const phi = streams > 0 ? ((Math.floor(rand() * streams) + 0.5) / streams) * TAU : rand() * TAU;
    const r = landRadius + (mist ? (rand() - 0.5) * 0.3 : 0);
    positions.set([r * Math.sin(phi), source.y + 0.005, r * Math.cos(phi)], i * 3);
    seeds.set(
      mist ? [rand() * 50, 0.25 + rand() * 0.2, 1, 0.22 + rand() * 0.2] : [rand() * 50, 2.2 + rand() * 2.2, 0, 0.007 + rand() * 0.007],
      i * 4,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 4));
  // The shader moves the points, so give the bounds by hand: everything stays within the basin.
  geometry.boundingSphere = new Sphere(new Vector3(0, 0.9, 0), 1.6);
  const material = new ShaderMaterial({
    uniforms: { uTime: time, uScale: { value: 800 } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  return new Points(geometry, material);
}
