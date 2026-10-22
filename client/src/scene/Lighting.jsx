import { Environment, Lightformer } from '@react-three/drei';
import { EffectComposer, Bloom, SSAO, DepthOfField, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

/**
 * Image-based lighting, one key light with soft shadows, warm practical lights, and the post stack.
 *
 * Environment: by default it is built procedurally from window-like light panels, so it works
 * offline and needs no download. Pass `hdri="/hdri/room.hdr"` (a CC0 interior HDRI in client/public)
 * for a real captured environment.
 *
 * quality="low" drops SSAO and DepthOfField, the two most expensive passes.
 */
export default function Lighting({ quality = 'high', hdri = null }) {
  const ultra = quality === 'high';

  return (
    <>
      {hdri ? (
        <Environment files={hdri} background={false} environmentIntensity={0.7} />
      ) : (
        <Environment resolution={256} background={false} environmentIntensity={0.6}>
          {/* Moonlit window, warm lamp glow and a soft ceiling bounce */}
          <Lightformer form="rect" intensity={3} color="#cfe0ff" position={[-6, 3, -2]} scale={[4, 4, 1]} target={[0, 0, 0]} />
          <Lightformer form="rect" intensity={1.4} color="#ffb36b" position={[0, 6, 6]} scale={[10, 3, 1]} target={[0, 0, 0]} />
          <Lightformer form="rect" intensity={0.8} color="#fff4e6" position={[0, 8, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 12, 1]} />
        </Environment>
      )}

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

      {/* Warm practicals: fireplace, lamps. Later, map these to real light fixtures in the GLB. */}
      <pointLight position={[-9, 2.4, -2]} color="#ffb36b" intensity={18} distance={14} decay={2} castShadow={ultra} shadow-mapSize={[512, 512]} />
      <pointLight position={[9, 2.2, 1]} color="#ffa552" intensity={14} distance={12} decay={2} />
      <pointLight position={[0, 3.2, -8]} color="#ffd9a8" intensity={10} distance={10} decay={2} />

      <EffectComposer multisampling={0}>
        {ultra && <SSAO samples={21} radius={0.08} intensity={22} luminanceInfluence={0.5} />}
        <Bloom intensity={ultra ? 0.35 : 0.25} luminanceThreshold={ultra ? 0.85 : 0.9} luminanceSmoothing={0.2} mipmapBlur />
        {ultra && <DepthOfField focusDistance={0.02} focalLength={0.04} bokehScale={2.2} />}
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </>
  );
}
