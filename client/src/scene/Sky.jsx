import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BackSide, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import { SUN } from '../world/config';

// The sky over the open courtyard: a golden-hour gradient (dusky violet overhead, blush rose, honey gold at the
// horizon), the low sun with its glow, and thin sunlit clouds, all computed in one fragment shader. One draw call,
// no textures. It is a sphere that follows the camera, drawn first and behind everything (no depth write), so it
// never clips the house however far the camera goes.

const VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // on the far plane
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uSun;
  uniform float uTime;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int k = 0; k < 5; k++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -0.2, 1.0);
    float sunDot = max(dot(d, uSun), 0.0);
    float toward = pow(max(dot(normalize(vec2(d.x, d.z)), normalize(vec2(uSun.x, uSun.z))), 0.0), 2.0); // the sun's side

    // Gradient: honey gold at the horizon, blush rose, then dusky violet overhead. Warmer on the sun's side.
    vec3 horizon = mix(vec3(1.25, 0.62, 0.32), vec3(1.6, 0.86, 0.42), toward);
    vec3 rose = mix(vec3(0.82, 0.42, 0.5), vec3(1.05, 0.55, 0.5), toward);
    vec3 zenith = vec3(0.24, 0.2, 0.38);
    vec3 col = mix(horizon, rose, smoothstep(0.0, 0.22, h));
    col = mix(col, zenith, smoothstep(0.25, 0.95, h));
    col = mix(col, vec3(0.32, 0.2, 0.2), smoothstep(0.0, -0.2, d.y)); // below the horizon: haze

    // Thin streaks of cloud, lit gold-pink from below on the sun's side.
    if (d.y > 0.02) {
      vec2 uv = d.xz / (d.y + 0.25) * 1.4 + vec2(uTime * 0.004, 0.0);
      float c = fbm(uv * vec2(0.8, 2.6));
      c = smoothstep(0.52, 0.82, c) * smoothstep(0.02, 0.25, d.y) * (1.0 - smoothstep(0.55, 0.95, d.y));
      vec3 lit = mix(vec3(0.9, 0.5, 0.55), vec3(1.9, 1.05, 0.6), toward);
      col = mix(col, lit, c * 0.75);
    }

    // The sun: a bright disc, a tight halo and a broad warm glow (above 1.0, so the bloom pass catches it).
    col += vec3(1.6, 0.9, 0.45) * pow(sunDot, 12.0) * 0.6;
    col += vec3(2.0, 1.2, 0.6) * pow(sunDot, 180.0) * 1.5;
    col += vec3(8.0, 6.0, 4.0) * smoothstep(0.9993, 0.9997, sunDot);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export default function Sky() {
  const mesh = useMemo(() => {
    const material = new ShaderMaterial({
      uniforms: { uSun: { value: SUN.direction.clone() }, uTime: { value: 0 } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: BackSide,
      depthWrite: false,
      depthTest: true,
    });
    const m = new Mesh(new SphereGeometry(100, 32, 16), material);
    m.frustumCulled = false;
    m.renderOrder = -1000; // first, so everything else draws over it
    return m;
  }, []);

  useEffect(() => () => {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }, [mesh]);

  useFrame((state) => {
    mesh.position.copy(state.camera.position);
    mesh.material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return <primitive object={mesh} />;
}
