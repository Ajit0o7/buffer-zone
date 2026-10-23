// Render layers. The main camera sees both; the marble floor's mirror camera (drei MeshReflectorMaterial) sees only
// layer 0, so anything on NO_REFLECT is drawn once instead of twice. That's for things that cost draw calls or
// triangles but hardly show in a floor reflection: leaves and flowers, crystals and chain links, the photos,
// particles and light shafts. Raycasts use layer 0 too, so keep clickable hitboxes there.

export const NO_REFLECT = 1;

/** Moves an object and everything under it to the NO_REFLECT layer. */
export function keepOutOfReflections(object) {
  object?.traverse((o) => o.layers.set(NO_REFLECT));
  return object;
}
