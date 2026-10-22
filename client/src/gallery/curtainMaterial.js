import { DoubleSide, MeshStandardMaterial } from 'three';

/**
 * Velvet curtain material for the instanced curtain halves.
 *
 * The cloth is deformed entirely in the vertex shader from one per-instance attribute, `aOpen`
 * (0 closed .. 1 parted), so hundreds of curtains animate with no CPU geometry work and in a
 * single draw call. Each half is a plane hanging from the rod: local x runs from the outer edge
 * (-halfWidth) to the centre seam (0), local y from the rod (0) down to the hem (-height).
 * The right half is the same geometry mirrored by its instance matrix (scale x = -1).
 *
 * Parting: the cloth gathers toward its outer edge (the hem trails the rod slightly, like real
 * drapery), the pleats deepen as it bunches, and the inner edge lifts a little near the hem, as if
 * caught by a tie-back. A slow, low-amplitude sway keeps it from looking frozen.
 */
export function createCurtainMaterial({ halfWidth, height, color = '#5c0f1c' }) {
  const uniforms = {
    uHalfW: { value: halfWidth },
    uHeight: { value: height },
    uTime: { value: 0 },
  };

  const material = new MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, side: DoubleSide });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
attribute float aOpen;
uniform float uHalfW;
uniform float uHeight;
uniform float uTime;
#define CURTAIN_PLEATS 7.0
#define TWO_PI_C 6.2831853

vec3 curtainDeform(vec3 p, out vec3 n) {
  float u = clamp((p.x + uHalfW) / uHalfW, 0.0, 1.0); // 0 at the outer edge, 1 at the centre seam
  float v = clamp(-p.y / uHeight, 0.0, 1.0);          // 0 at the rod, 1 at the hem
  float gather = aOpen * (0.86 - 0.18 * v * v);       // the hem gathers a little less than the rod
  float span = uHalfW * (1.0 - gather);
  float x = -uHalfW + u * span;
  float amp = 0.03 + 0.07 * gather;                   // pleats deepen as the cloth bunches
  float phase = u * CURTAIN_PLEATS * TWO_PI_C;
  float sway = 0.012 * v * sin(uTime * 1.1 + u * 3.0 + aOpen * 2.0);
  float z = amp * sin(phase) + sway;
  float y = p.y + aOpen * 0.12 * v * u * u;           // tie-back lift at the inner hem
  float dzdx = amp * CURTAIN_PLEATS * TWO_PI_C * cos(phase) / max(span, 1e-3);
  n = normalize(vec3(-dzdx, 0.0, 1.0));
  return vec3(x, y, z);
}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `vec3 curtainNormal;
vec3 curtainPosition = curtainDeform(position, curtainNormal);
vec3 objectNormal = curtainNormal;
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif`,
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = curtainPosition;');
  };
  // All curtains share one program; this key keeps three from reusing a plain MeshStandardMaterial's.
  material.customProgramCacheKey = () => 'curtain-velvet-v1';

  return { material, uniforms };
}
