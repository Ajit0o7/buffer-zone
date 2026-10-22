import { Environment } from '@react-three/drei';
import { EffectComposer, Bloom, SSAO, DepthOfField, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

/**
 * Image-based lighting, one key light with soft shadows, warm practical lights, and the
 * post stack. Quality is tiered: on weak devices, drop SSAO and DepthOfField first.
 */
export default function Lighting({ quality = 'high' }) {
  const ultra = quality === 'high';

  return (
    <>
      {/* IBL: drei's built-in preset. For a true interior, replace with a CC0 HDRI: files="/hdri/<name>.hdr" */}
      <Environment preset="apartment" background={false} environmentIntensity={0.7} />

      {/* Key light (moonlight through the windows): this is the one shadow caster */}
      <directionalLight
        position={[8, 14, 6]}
        intensity={1.6}
        color="#cfe0ff"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-22}
        shadow-camera-right={22}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
        shadow-camera-near={1}
        shadow-camera-far={50}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-radius={6}
      />

      {/* Warm practicals: fireplace, lamps. Mapped to real light fixtures in the GLB later. */}
      <pointLight position={[-9, 2.4, -2]} color="#ffb36b" intensity={18} distance={14} decay={2} castShadow={ultra} shadow-mapSize={[512, 512]} />
      <pointLight position={[9, 2.2, 1]} color="#ffa552" intensity={14} distance={12} decay={2} />
      <pointLight position={[0, 3.2, -8]} color="#ffd9a8" intensity={10} distance={10} decay={2} />

      {ultra ? (
        <EffectComposer multisampling={0}>
          <SSAO samples={21} radius={0.08} intensity={22} luminanceInfluence={0.5} />
          <Bloom intensity={0.35} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur />
          <DepthOfField focusDistance={0.02} focalLength={0.04} bokehScale={2.2} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      ) : (
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.25} luminanceThreshold={0.9} mipmapBlur />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
    </>
  );
}
