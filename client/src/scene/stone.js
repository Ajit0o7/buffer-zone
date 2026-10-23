import { DataTexture, MeshStandardMaterial, RGBAFormat, SRGBColorSpace } from 'three';

const TILE = 1.6; // metres per repeat of the stone texture
const STONE = { roughness: 0.85, metalness: 0 };

// Stand-in when the house's texture isn't available: plain stone grey.
const GREY = new DataTexture(new Uint8Array([168, 160, 146, 255]), 1, 1, RGBAFormat);
GREY.colorSpace = SRGBColorSpace;
GREY.needsUpdate = true;

/**
 * A material for instanced props built from boxes, so many differently sized parts share one draw call:
 *
 * - Parts with a pale or dark, unsaturated instance colour are stone. They take the house's own stone
 *   texture in world space (triplanar: each face samples it projected along its own axis), so boxes of
 *   any size get unstretched texture that lines up across neighbouring parts, and a matte finish.
 * - Parts with a strong instance colour (carpet, brass) skip the texture and keep this material's own
 *   roughness and metalness (`tinted`).
 */
export function stoneMaterial(map, tinted) {
  const material = new MeshStandardMaterial({ roughness: tinted.roughness, metalness: tinted.metalness });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.stoneMap = { value: map ?? GREY };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStonePos;\nvarying vec3 vStoneNormal;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 stoneWorld = vec4(transformed, 1.0);
        vec3 stoneNormal = objectNormal;
        #ifdef USE_INSTANCING
          stoneWorld = instanceMatrix * stoneWorld;
          stoneNormal = mat3(instanceMatrix) * stoneNormal;
        #endif
        vStonePos = (modelMatrix * stoneWorld).xyz;
        vStoneNormal = mat3(modelMatrix) * stoneNormal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D stoneMap;\nvarying vec3 vStonePos;\nvarying vec3 vStoneNormal;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float stoneAmount = 1.0;
        #ifdef USE_INSTANCING_COLOR
          float saturation = max(vColor.r, max(vColor.g, vColor.b)) - min(vColor.r, min(vColor.g, vColor.b));
          stoneAmount = 1.0 - smoothstep(0.1, 0.3, saturation);
        #endif
        {
          vec3 w = pow(abs(normalize(vStoneNormal)), vec3(4.0));
          w /= w.x + w.y + w.z;
          vec3 p = vStonePos / ${TILE.toFixed(2)};
          vec3 stone = texture2D(stoneMap, p.zy).rgb * w.x + texture2D(stoneMap, p.xz).rgb * w.y + texture2D(stoneMap, p.xy).rgb * w.z;
          diffuseColor.rgb *= mix(vec3(1.0), stone, stoneAmount);
        }`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, ${STONE.metalness.toFixed(2)}, stoneAmount);
        roughnessFactor = mix(roughnessFactor, ${STONE.roughness.toFixed(2)}, stoneAmount);`,
      );
  };
  material.customProgramCacheKey = () => 'instanced-stone';
  return material;
}
