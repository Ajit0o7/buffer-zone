import { DoubleSide, MeshStandardMaterial } from 'three';

// One clock for every plant in the house, advanced once a frame by Greenery.
export const windTime = { value: 0 };

/**
 * A cut-out leaf material for instanced quads that sway in the wind.
 *
 * - Per instance, `aSway` = (amplitude in metres, phase). The whole leaf is pushed sideways by a slow
 *   two-frequency breeze, so leaves on one strand (same phase, amplitude growing toward the tip) move
 *   together like a hanging rope; its tip also flutters a little on its own.
 * - `cells` > 1 makes the map an atlas of that many cells side by side, picked per instance by `aCell`.
 * - Alpha-tested and two-sided: no transparency sorting, any draw order works.
 * - A touch of the leaf's own colour is added as emission, standing in for light through thin leaves,
 *   so undersides in shade don't go black.
 */
export function foliageMaterial(map, { roughness = 0.75, cells = 1, glow = 0.12 } = {}) {
  const material = new MeshStandardMaterial({ map, alphaTest: 0.5, side: DoubleSide, roughness, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uWindTime;
        attribute vec2 aSway;
        ${cells > 1 ? 'attribute float aCell;' : ''}`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        ${cells > 1 ? `#ifdef USE_MAP\nvMapUv.x = (vMapUv.x + aCell) / ${cells.toFixed(1)};\n#endif` : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float t = uWindTime;
          float ph = aSway.y;
          vec3 wind = vec3(
            sin(t * 0.9 + ph) * 0.65 + sin(t * 2.1 + ph * 1.7) * 0.25,
            0.0,
            sin(t * 0.7 + ph * 0.6) * 0.35 + sin(t * 1.7 + ph * 2.3) * 0.15
          ) * aSway.x;
          // The tip of each leaf flutters about its stalk, more on swaying strands.
          transformed.z += sin(t * 5.3 + ph * 7.0 + float(gl_InstanceID) * 0.37) * 0.12 * position.y * min(aSway.x * 12.0 + 0.15, 1.0);
          #ifdef USE_INSTANCING
            transformed += inverse(mat3(instanceMatrix)) * wind; // the breeze is in world space
          #endif
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
          // Mipmaps average a thin leaf's edges away, so far foliage would thin out to nothing:
          // boost alpha with the mip level being sampled, keeping each leaf's coverage at any distance.
          {
            vec2 texel = vMapUv * vec2(textureSize(map, 0));
            vec2 dx = dFdx(texel);
            vec2 dy = dFdy(texel);
            float lod = 0.5 * log2(max(dot(dx, dx), dot(dy, dy)));
            diffuseColor.a *= 1.0 + max(lod, 0.0) * 0.3;
          }
        #endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * ${glow.toFixed(3)};`,
    );
  };
  material.customProgramCacheKey = () => `greenery-foliage-${cells}-${glow}`;
  return material;
}
