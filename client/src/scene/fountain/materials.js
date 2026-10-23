import { Color, DoubleSide, MeshStandardMaterial } from 'three';

// The fountain's three surface materials, each a MeshStandardMaterial with a little procedural shader code
// patched in (onBeforeCompile), so they take the scene's sun, shadows and environment reflections like
// everything else. No textures: veins, ripples and streaks are all computed per pixel.
//
// Shaders work in the fountain's own frame (its group is only ever translated, never rotated or scaled, so
// object-space directions are world directions).

const NOISE = /* glsl */ `
  float fHash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float fHash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float fHash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
  float fNoise2(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(fHash12(i), fHash12(i + vec2(1.0, 0.0)), u.x), mix(fHash12(i + vec2(0.0, 1.0)), fHash12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fNoise3(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
    float a = mix(fHash13(i), fHash13(i + vec3(1.0, 0.0, 0.0)), u.x);
    float b = mix(fHash13(i + vec3(0.0, 1.0, 0.0)), fHash13(i + vec3(1.0, 1.0, 0.0)), u.x);
    float c = mix(fHash13(i + vec3(0.0, 0.0, 1.0)), fHash13(i + vec3(1.0, 0.0, 1.0)), u.x);
    float d = mix(fHash13(i + vec3(0.0, 1.0, 1.0)), fHash13(i + vec3(1.0, 1.0, 1.0)), u.x);
    return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
  }
`;

/**
 * Polished white marble, veined in 3D (so veins run on unbroken across mouldings, as in carved stone).
 * Vertex colours carry baked shade (occlusion, the green of stone under water); aWet darkens and glosses.
 */
export function marbleMaterial() {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0, envMapIntensity: 1 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWet;\nvarying float vWet;\nvarying vec3 vMarble;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMarble = transformed;\nvWet = aWet;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vWet;\nvarying vec3 vMarble;\n${NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float veinAmount;
        {
          vec3 p = vMarble * 2.3 + vec3(11.0, 3.0, 7.0);
          float warp = fNoise3(p) * 0.5 + fNoise3(p * 2.1) * 0.27 + fNoise3(p * 4.3) * 0.15 + fNoise3(p * 8.9) * 0.08;
          // Main veins: thin lines where a warped diagonal field crosses zero; finer hairlines between them.
          float main = 1.0 - abs(sin(dot(p, vec3(0.55, 0.8, 0.3)) * 1.7 + warp * 7.0));
          float hair = 1.0 - abs(sin(dot(p, vec3(-0.4, 0.35, 0.85)) * 4.1 + warp * 11.0));
          float veins = pow(main, 26.0) * 0.85 + pow(hair, 60.0) * 0.4;
          veins *= smoothstep(0.25, 0.6, fNoise3(p * 0.7 + 4.0)) * 0.7 + 0.3; // veins come and go
          veinAmount = clamp(veins, 0.0, 1.0);
          float cloud = fNoise3(p * 1.3 + 9.0) * 0.6 + fNoise3(p * 5.0) * 0.4; // soft milky clouding
          vec3 stone = mix(vec3(0.95, 0.925, 0.875), vec3(0.985, 0.975, 0.955), cloud);
          stone = mix(stone, vec3(0.55, 0.54, 0.53), veinAmount * 0.75);
          diffuseColor.rgb *= stone * mix(1.0, 0.72, vWet);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor + 0.08 * veinAmount, 0.06, vWet);`,
      );
  };
  material.customProgramCacheKey = () => 'fountain-marble';
  return material;
}

/**
 * The pools' surface. Height is a sum of two slowly scrolling noise layers and rings spreading from where
 * each stream lands; its slope bends the normal, and the standard lighting does the rest. Foam lightens
 * the water where the streams land. Transparency rises toward grazing angles, as water's reflectance does.
 */
export function waterMaterial(time) {
  const material = new MeshStandardMaterial({
    color: new Color('#1b3a33'),
    roughness: 0.05,
    metalness: 0,
    envMapIntensity: 1,
    transparent: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aPool;\nvarying vec3 vPool;\nvarying vec3 vWater;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWater = transformed;\nvPool = aPool;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        varying vec3 vPool;
        varying vec3 vWater;
        ${NOISE}
        // Distance from p to the nearest place a stream lands (pool: x streams, y landing radius, z seed),
        // and that stream's own random number.
        vec2 fLanding(vec2 p) {
          if (vPool.x < 0.5) return vec2(abs(length(p) - vPool.y), fHash12(floor(p * 3.0)));
          float a = atan(p.x, p.y) / 6.2831853 * vPool.x - 0.5;
          float k = floor(a + 0.5);
          float phi = (k + 0.5) / vPool.x * 6.2831853;
          return vec2(length(p - vPool.y * vec2(sin(phi), cos(phi))), fHash11(k + vPool.z * 17.0));
        }
        float fWaterHeight(vec2 p) {
          float t = uTime;
          float h = fNoise2(p * 6.0 + vec2(t * 0.11, t * 0.05)) * 0.6 + fNoise2(p * 11.0 - vec2(t * 0.07, -t * 0.13)) * 0.4;
          h *= 0.006;
          vec2 land = fLanding(p);
          float d = land.x + 0.012 * fNoise2(p * 25.0);
          h += 0.0035 * sin(d * 60.0 - t * 8.0 - land.y * 6.28) * exp(-d * 7.0);
          return h;
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec2 p = vWater.xz;
          float e = 0.003;
          float h0 = fWaterHeight(p);
          vec3 n = normalize(vec3(-(fWaterHeight(p + vec2(e, 0.0)) - h0) / e, 1.0, -(fWaterHeight(p + vec2(0.0, e)) - h0) / e));
          normal = normalize((viewMatrix * vec4(n, 0.0)).xyz);
          vec2 land = fLanding(p);
          float foam = exp(-land.x * 16.0) * smoothstep(0.35, 0.75, fNoise2(p * 38.0 + vec2(0.0, uTime * 1.7)) * 0.6 + fNoise2(p * 90.0 - uTime * 2.3) * 0.4 + 0.15);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.86, 0.84), foam * 0.75);
          float facing = abs(dot(normal, normalize(vViewPosition)));
          diffuseColor.a = clamp(mix(0.97, 0.62, facing) + foam * 0.3, 0.0, 1.0);
        }`,
      );
  };
  material.customProgramCacheKey = () => 'fountain-water';
  return material;
}

/**
 * The falling sheets: broken into streams (or, with no stream count, a whole bell), each streaked with
 * fast-moving lines that speed up as they fall, thinning and breaking into drops toward the bottom.
 */
export function fallsMaterial(time) {
  const material = new MeshStandardMaterial({
    color: new Color('#d9e6e2'),
    roughness: 0.12,
    metalness: 0,
    envMapIntensity: 1.2,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aFall;\nvarying vec3 vFall;\nvarying vec2 vFallUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFall = aFall;\nvFallUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec3 vFall;\nvarying vec2 vFallUv;\n${NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float u = vFallUv.x;
          float v = vFallUv.y;
          float streams = vFall.x;
          float flow = v - uTime / vFall.z * 0.9; // scrolls one fall-length per fall time (a touch slower reads better)
          float mask;
          float across;
          if (streams > 0.5) {
            float s = u * streams;
            float k = floor(s);
            float r = fHash11(k + vFall.y * 17.0);
            float f = fract(s) - 0.5 + 0.05 * sin(v * 9.0 + r * 30.0 + uTime * 2.5); // a little sway
            float width = mix(0.2, 0.36, r) * (1.0 - 0.4 * v); // narrows as it speeds up
            mask = smoothstep(width, width * 0.4, abs(f));
            across = s * 9.0;
          } else {
            mask = 0.85;
            across = u * 70.0;
          }
          // Streaks: noise stretched along the fall, scrolled down it.
          float streak = fNoise2(vec2(across, flow * 7.0)) * 0.65 + fNoise2(vec2(across * 2.3, flow * 15.0)) * 0.35;
          // Near the bottom the sheet tears into drops; at the very top it eases out over the lip.
          float tear = smoothstep(1.0, 0.6, v + 0.35 * fNoise2(vec2(across * 1.7, flow * 22.0)));
          float ease = smoothstep(0.0, 0.06, v);
          diffuseColor.a = mask * tear * ease * (0.22 + 0.6 * streak * streak);
          diffuseColor.rgb *= 0.85 + 0.3 * streak;
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        // Light caught inside the falling water: keeps the sheets visible even in shade.
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.06, 0.065, 0.06) * diffuseColor.a;',
      );
  };
  material.customProgramCacheKey = () => 'fountain-falls';
  return material;
}
