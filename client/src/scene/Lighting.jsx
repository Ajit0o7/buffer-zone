import { useEffect, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import {
  Bloom,
  BrightnessContrast,
  DepthOfField,
  EffectComposer,
  HueSaturation,
  LUT,
  SSAO,
  ToneMapping,
} from '@react-three/postprocessing';
import { LUTCubeLoader, ToneMappingMode } from 'postprocessing';
import { Vector3 } from 'three';
import { usePerf } from '../state/perf';
import { localMotion } from '../world/shared';
import { couple, useCouple } from '../world/couple';
import { LUT_URL } from '../world/config';

const SUN_DIRECTION = new Vector3(8, 14, 6).normalize();
const SUN_DISTANCE = 30;
const SHADOW_EXTENT = 12; // half-size of the shadow box around the player, in metres

/**
 * The key light follows the local player and its shadow box covers only the area around them.
 * The house itself doesn't cast shadows (its occlusion is baked or comes from image-based lighting;
 * see docs/PERFORMANCE.md), so the shadow pass draws just the two avatars: a few thousand triangles
 * instead of the house's quarter of a million, every frame.
 */
function FollowSun() {
  const light = useRef();
  const target = useRef();

  useEffect(() => {
    light.current.target = target.current;
  }, []);

  useFrame(() => {
    target.current.position.copy(localMotion.position);
    light.current.position.copy(localMotion.position).addScaledVector(SUN_DIRECTION, SUN_DISTANCE);
  });

  return (
    <>
      <directionalLight
        ref={light}
        intensity={1.6}
        color="#cfe0ff"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-SHADOW_EXTENT}
        shadow-camera-right={SHADOW_EXTENT}
        shadow-camera-top={SHADOW_EXTENT}
        shadow-camera-bottom={-SHADOW_EXTENT}
        shadow-camera-near={1}
        shadow-camera-far={SUN_DISTANCE * 2}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
      <object3D ref={target} />
    </>
  );
}

/** Optional .cube colour grade: one 3D-texture lookup, merged into the same pass as tone mapping. */
function Grade() {
  const lut = useLoader(LUTCubeLoader, LUT_URL);
  return <LUT lut={lut} />;
}

/**
 * Post-processing by tier. Every effect listed in one composer is merged into a single full-screen
 * pass, except SSAO and depth of field, which need their own (depth, normals, blur): those are the
 * expensive ones, so they exist only in the opt-in cinematic tier.
 *   low       - tone mapping only (one cheap pass)
 *   high      - bloom + light colour grade + tone mapping (default)
 *   cinematic - adds SSAO and depth of field (?quality=cinematic)
 */
function Post({ tier }) {
  // Photo mode adds depth of field in any tier, focused on the midpoint of the two of you: it is the one moment
  // the extra pass is worth it, and it costs nothing the rest of the time (the effect isn't mounted).
  const photo = useCouple((s) => s.photoMode);
  const portrait = <DepthOfField target={couple.photo.focus} focusRange={0.03} focalLength={0.03} bokehScale={2} resolutionScale={1} />;
  if (tier === 'low') {
    return (
      <EffectComposer multisampling={0}>
        {photo && portrait}
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    );
  }
  const cinematic = tier === 'cinematic';
  return (
    <EffectComposer multisampling={0} enableNormalPass={cinematic}>
      {cinematic && <SSAO samples={16} radius={0.12} intensity={18} luminanceInfluence={0.5} />}
      <Bloom intensity={0.3} luminanceThreshold={0.88} luminanceSmoothing={0.2} mipmapBlur />
      {photo ? portrait : cinematic && <DepthOfField focusDistance={0.02} focalLength={0.006} bokehScale={1} />}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <HueSaturation saturation={0.06} />
      <BrightnessContrast contrast={0.05} />
      {LUT_URL && <Grade />}
    </EffectComposer>
  );
}

/**
 * Image-based lighting, the player-following sun (the one shadow-casting light) and tiered
 * post-processing. The rooms' own lamps, candles and hearth are lit by a fixed pool of three
 * short-range point lights in Practicals.jsx, which the house renders with its furnishings.
 * The post tier comes from the performance governor (scene/PerfGovernor.jsx) or the ?quality= URL
 * parameter.
 */
export default function Lighting({ hdri = null }) {
  const tier = usePerf((s) => s.tier);

  return (
    <>
      {hdri ? (
        <Environment files={hdri} background={false} environmentIntensity={0.75} />
      ) : (
        <Environment resolution={256} background={false} environmentIntensity={0.6}>
          {/* Moonlit window, warm lamp glow and a soft ceiling bounce */}
          <Lightformer form="rect" intensity={3} color="#cfe0ff" position={[-6, 3, -2]} scale={[4, 4, 1]} target={[0, 0, 0]} />
          <Lightformer form="rect" intensity={1.4} color="#ffb36b" position={[0, 6, 6]} scale={[10, 3, 1]} target={[0, 0, 0]} />
          <Lightformer form="rect" intensity={0.8} color="#fff4e6" position={[0, 8, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 12, 1]} />
        </Environment>
      )}
      <FollowSun />
      <Post tier={tier} />
    </>
  );
}
