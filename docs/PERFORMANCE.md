# Performance: holding 90+ fps

Target: **11.1 ms per frame** (90 Hz) on a mid-range GPU, with headroom for 120/144 Hz displays. Every choice
below either removes work from that budget or makes the remaining work cheaper.

> **Measured vs designed.** The development sandbox renders in software at about 1.4 fps, so frame times could
> not be measured there. What *was* verified in a browser: with five rooms, the grand stair, 18 curtained paintings
> and the practical lights, a frame draws 34–51 calls with one player in view and about 65–70 with both avatars on
> screen (including the shadow pass and post-processing), and about 250 k triangles. Photo textures cost zero VRAM until revealed, the zone bake completes, and nothing logs errors.
> Profile on real hardware with the steps in [Measuring](#7-measuring) before treating 90 fps as met.

## 1. Budget

| Item | Budget | Where it's enforced |
|---|---|---|
| Frame time | ≤ 11.1 ms (90 Hz) | `scene/PerfGovernor.jsx` scales DPR and post tier down below 85 fps |
| Draw calls | ≤ 150 (measured 34–70) | house (≈25 primitives) + avatars + 2 gallery batches + 1 stair + 2 props + 1 per *revealed* painting + post |
| Lights | 1 shadow-casting + 2 spots + 3 points, fixed | the counts never change, so no shader recompiles mid-walk |
| Shadow pass | avatars only (~100 k tris) | house, stair and props have `castShadow = false` |
| Full-screen passes | 1 (low/high tier), 4–5 (cinematic) | `scene/Lighting.jsx` |
| Photo VRAM | ≤ 6 textures resident once idle, ≤ 128 MB | `gallery/textureCache.js` (LRU) |
| Pixel ratio | 1.0–1.5 | Canvas `dpr={[1, 1.5]}` + governor |

## 2. Lighting and shadows

**Implemented**

- **Image-based lighting does the ambient work.** One HDRI (`HDRI_URL`) lights every PBR surface through the
  environment map: no per-light cost per pixel.
- **One shadow-casting light, and only the avatars cast.** `FollowSun` in `scene/Lighting.jsx` keeps a 24 m
  shadow box centred on the local player. The house doesn't cast (`Mansion.jsx`), so the shadow pass renders
  two skinned meshes instead of a quarter-million-triangle building every frame. Map size is 1024², fixed:
  resizing a shadow map at runtime forces a reallocation.
- **A fixed pool of spotlights for paintings** (`GALLERY.spotlights = 2`, in `gallery/PhotoFrames.jsx`). Each
  light adds cost to every lit fragment, and adding or removing a light recompiles every lit shader, which is a
  visible hitch. The pool keeps the light count constant and moves the lights to the most-open nearby paintings
  that can be seen from the viewer's rooms.
- **A fixed pool of three point lights for the rooms' lamps, candles and hearth** (`scene/Practicals.jsx`). Each
  reaches 10 m and casts no shadow. They go to the nearest practicals that can be seen from the viewer's rooms and
  fade as they change hands; practicals in other rooms stay dark (their props still glow, through bloom). See
  [ROOMS.md](ROOMS.md#practical-lights-scenepracticalsjsx).
- **Static lightmap hook.** Set `LIGHTMAP_URL` in `world/config.js` and `Mansion.jsx` applies it to every mesh
  with a second UV set (`uv1` / glTF `TEXCOORD_1`), with `texture.channel = 1`.

**Baking the lightmap (Blender 4.x, Cycles)**

1. Import `mansion.glb`. For each mesh, add a second UV map (`UVMap.001`) and run *Smart UV Project* on it
   (island margin 0.02), or pack all objects into one atlas with *Pack Islands*.
2. Add an Image Texture node (not connected) holding a new 4096² **32-bit float** image to every material, and
   select it as the active node.
3. Render → Bake → *Diffuse*, with **Direct + Indirect** and **Color off** (lighting only), margin 8 px, using
   the same HDRI as `HDRI_URL` for the world. For an ambient-occlusion-only map, bake *Ambient Occlusion* instead
   and write it into the green channel of the ORM texture rather than using a lightmap.
4. Save as EXR (or a 16-bit PNG if your `toktx` build can't read EXR), then convert to a compressed texture:
   `toktx --t2 --encode uastc --uastc_quality 2 --zcmp 18 --assign_oetf linear lightmap.ktx2 lightmap.exr`
   (check flags with `toktx --help`; KTX-Software 4.3+).
5. Export the GLB with both UV sets (glTF exporter → *Include → UVs*). Point `LIGHTMAP_URL` at the map.

With a baked lightmap or AO, SSAO adds nothing a player would notice, which is why it lives only in the
cinematic tier.

## 3. Post-processing tiers

Post-processing effects listed in one `EffectComposer` are merged into **a single full-screen pass**, except
SSAO and depth of field, which each need extra passes (normals, depth, blur). So the tiers are:

| Tier | Effects | Passes | Chosen when |
|---|---|---|---|
| `low` | tone mapping; no mirror floor, sunbeams, petals or dust | 1 | governor factor < 0.35, or `?quality=low` |
| `medium` | as high, but the marble floor reflects only the environment, not the room | 1 + bloom's mip chain | factor < 0.6, or `?quality=medium` |
| `high` | bloom (mip-blur), hue/saturation, contrast, vignette, optional LUT, tone mapping; the mirror floor | 1 + bloom's mip chain, + the mirror's scene render | default |
| `cinematic` | high + SSAO + depth of field | 4–5 | only with `?quality=cinematic` |

The **colour grade** is a 3D LUT (`LUT_URL`, a `.cube` file loaded with `LUTCubeLoader`): one texture lookup in
the merged pass, so a full film look costs almost nothing. Without a LUT, a light hue/saturation and contrast
grade stands in.

**The governor** (`scene/PerfGovernor.jsx`) uses drei's `PerformanceMonitor`: it averages frame times and moves a
factor between 0 and 1, down while the frame rate is below 85 fps and up again above 88 (on a 90 Hz or faster
display; scaled for slower ones). The pixel ratio follows the factor continuously (1.25 up to the screen's own
density, 2 at most); below 0.6 the floor's mirror goes (it redraws the scene: the costliest single effect), below 0.35
the low tier takes over; after four flip-flops it settles on the safe setting for the session.

## 4. GPU texture compression (KTX2 / Basis Universal)

JPEG, PNG and WebP are small on disk but **decompress to full RGBA8 in VRAM** (a 2048² texture with mips is
about 22 MB). KTX2 with Basis Universal transcodes at load time to the GPU's native compressed format (BC7 on
desktop, ASTC on Apple and most Android, ETC2 otherwise) at 4–8× less VRAM, and it uploads with no decode step.

**Pipeline** (requires [KTX-Software](https://github.com/KhronosGroup/KTX-Software) `toktx` on your PATH):

```bash
# House: Draco geometry, then compress textures by role.
npx @gltf-transform/cli@4 copy Sponza.gltf mansion-raw.glb
npx @gltf-transform/cli@4 resize mansion-raw.glb step1.glb --width 2048 --height 2048

# Colour (base colour, emissive): ETC1S, small and good enough for albedo.
npx @gltf-transform/cli@4 etc1s step1.glb step2.glb --slots "{baseColorTexture,emissiveTexture}" --quality 192

# Data maps (normal, ORM): UASTC, which keeps the precision normals need.
npx @gltf-transform/cli@4 uastc step2.glb step3.glb --slots "{normalTexture,occlusionTexture,metallicRoughnessTexture}" --level 2 --rdo --rdo-lambda 4

npx @gltf-transform/cli@4 draco step3.glb mansion.glb

# Or the one-step version (UASTC for everything; larger files):
npx @gltf-transform/cli@4 optimize mansion-raw.glb mansion.glb --compress draco --texture-compress ktx2 --texture-size 2048

# Photos: one KTX2 per photo; point photos.js `src` at the .ktx2 file.
toktx --t2 --encode uastc --uastc_quality 2 --zcmp 18 --genmipmap --assign_oetf srgb photo.ktx2 photo.jpg
```

`npm run assets` currently builds the house with WebP textures, because `toktx` isn't available everywhere;
swap its `--texture-compress webp` for `ktx2` once it is installed.

**Loading without blocking the render loop** (`scene/loaders.js`):

```js
ktx2 = new KTX2Loader()
  .setTranscoderPath('/basis/')   // copied from three by scripts/copy-decoders.mjs (postinstall)
  .setWorkerLimit(2)              // transcoding runs in 2 Web Workers, never on the main thread
  .detectSupport(gl);             // picks BC7 / ASTC / ETC2 for this GPU
```

- GLBs: `useGLTF(url, DRACO_PATH, false, withKTX2(gl))` hands the loader to `GLTFLoader` for
  `KHR_texture_basisu` textures.
- Photos: `gallery/textureCache.js` sends `.ktx2` files to the same loader. Other formats decode through
  `ImageBitmapLoader`, which also decodes off the main thread.
- Both then call `gl.initTexture(texture)` in the load callback, so the GPU upload happens between frames, not in
  the middle of the first frame that draws the texture.
- The Draco decoder path is set globally before any model loads, so no loader falls back to a CDN.

(`BasisTextureLoader` is the old name; three.js replaced it with `KTX2Loader`, which is what this uses.)

## 5. Culling and level of detail

- **Frustum culling:** three.js tests every mesh's bounding sphere against the camera each frame. The gallery's
  instanced meshes call `computeBoundingSphere()` whenever a frame is placed, so the batch is culled correctly
  as a whole.
- **Zone culling:** which rooms can see each painting and practical light is baked at load with physics rays
  (`world/VisibilityBake.jsx`, 2 ms per frame until done). From any other room, a painting's batched parts are
  collapsed (no vertex work), its photo isn't drawn, it gets no spotlight and it can't be clicked; a light gets no
  pool light and its props are hidden. Sponza is one open courtyard, so this culls modestly here; see
  [ROOMS.md](ROOMS.md#zone-culling-worldvisibilityjs-worldvisibilitybakejsx).
- **Distance culling:** paintings beyond 80 m (`DRAW_DISTANCE`) aren't drawn, those within 12 m always are, and a
  closed painting hands its photo back to the cache beyond 10 m (`GALLERY.releaseRadius`).
- **Lights:** the two pools mean paintings and lamps far from the player light nothing.
- **Physics:** the house is one fixed trimesh, and static colliders cost nothing per frame. Rapier only tests
  pairs whose bounding boxes overlap in its broad phase, which here means the two capsules. Curtains have
  **no colliders**: clicks use invisible hitbox planes, and while the mouse is locked, only those hitboxes are
  raycast from the screen centre, never the house.
- **Static transforms:** the house's meshes have `matrixAutoUpdate = false` after one update, so three doesn't
  recompose their matrices every frame.
- **LOD:** the curtain cloth is generated in the vertex shader (28×12 segments per half), so it costs little vertex
  work and needs no LOD. For heavy props added later, use drei's `<Detailed distances={[0, 15, 40]}>` with
  decimated copies (`gltf-transform simplify --ratio 0.25`). For a much larger house, split it per room and
  stream zones in at the doors (README roadmap).

## 6. Draw calls and Canvas hygiene

- **Instancing:** every painting's mounting (gilt frame, velvet backer, brass rod, ball finials and iron brackets,
  merged into one geometry) is one `InstancedMesh`, and every curtain half another (`gallery/GalleryBatch.jsx`):
  two draw calls however many paintings there are. The mounting's four finishes live in a 4×1 colour atlas and a
  4×1 roughness/metalness atlas, addressed by the parts' UVs, so one standard material covers them all. Curtains
  animate through a per-instance `aOpen` attribute, so opening them costs no CPU geometry work. Only revealed
  paintings add a draw call (each has a unique texture). The grand stair (one call) and the room props (two calls)
  are instanced the same way.
- **One shader program per material kind:** painting materials start with a 1×1 placeholder map, so loading the
  real photo is a uniform change, never a recompile. The curtain material sets `customProgramCacheKey`.
- **Canvas** (`scene/GameScene.jsx`):

  ```jsx
  <Canvas
    shadows
    dpr={[1, 1.5]}
    gl={{ antialias: false, stencil: false, depth: true, powerPreference: 'high-performance', toneMapping: NoToneMapping }}
    camera={{ fov: 60, near: 0.1, far: 250 }}
  />
  ```

  No MSAA and no stencil (neither is used, both cost bandwidth), tone mapping once at the end of the post chain,
  and a near/far ratio of 1:2500 that keeps depth precision on distant columns.
- **No React state in the render loop:** positions, curtain openness and texture state are plain mutable objects
  read in `useFrame`. React re-renders only for UI changes (caption, key card, tier).

## 7. Measuring

1. Add `r3f-perf` in development (`<Perf position="top-left" />` inside the Canvas) for fps, CPU/GPU ms, calls and
   triangles.
2. In the console (dev builds): `__three.gl.info` for calls, triangles, textures and programs (set
   `__three.gl.info.autoReset = false` and call `reset()` once per frame to count every pass of one frame);
   `__gallery.stats()` for resident photo textures and their estimated MB; `__zones.viewer.rooms` and
   `__zones.report()` for the rooms you're in and what each painting and light can be seen from.
3. Force tiers with `?quality=low|high|cinematic` to compare.
4. For per-call detail, capture a frame with [Spector.js](https://spector.babylonjs.com/).
5. On VR or high-refresh displays, check that frame time stays under budget with the browser's performance panel
   recording. GPU-bound frames show as long "GPU" bars, not JavaScript.
