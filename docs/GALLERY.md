# The curtain gallery

Every photo hangs in a gilt frame behind a velvet curtain. The curtain parts when you walk up to it or click it,
and the photo fades in. The design aims to scale to hundreds of paintings without running out of VRAM or draw
calls.

## Files

| File | Role |
|---|---|
| `gallery/photos.js` | Your data: `id`, `src`, `room`, `category`, `caption`, `date`, wall `position` and `rotation` |
| `gallery/PhotoFrames.jsx` | The gallery: batch, one `CurtainPhotoFrame` per photo, spotlight pool, centre-click, partner tracking |
| `gallery/CurtainPhotoFrame.jsx` | One painting: triggers, curtain animation, texture lifecycle, zone culling, caption |
| `gallery/GalleryBatch.jsx` | Instanced mountings (frame, backer, rod, finials, brackets) and curtains (2 draw calls total) |
| `gallery/curtainMaterial.js` | Velvet material whose vertex shader parts the cloth from one attribute |
| `gallery/textureCache.js` | Reference-counted photo textures with an LRU VRAM budget |
| `gallery/curtainState.js` | Shared overrides (held open or closed) and the partner's position |
| `gallery/dimensions.js` | Frame, painting, rod and curtain sizes |

## Lifecycle of one painting

```
scene start ──► frame, backer, rod and closed curtain drawn from the shared batch; photo: not loaded (0 VRAM)
   │
   ├─ player within 3.5 m, or a click (either player) ──► curtain eases open (vertex shader, aOpen 0→1)
   │                                                     │
   │                                     first reveal? ──► acquireTexture(src)
   │                                                       (decode in a worker or with createImageBitmap,
   │                                                        upload between frames)
   │                                                     │
   │                                     curtain > 35 % open and texture ready ──► photo fades in
   │
   ├─ player beyond 4.5 m (and no click override) ──► curtain eases closed, photo fades out
   │
   └─ closed, and player beyond 10 m ──► releaseTexture(src)
                                         idle textures stay cached (instant on return) while at most 6 are
                                         loaded and idle ones stay under 128 MB; beyond that the least
                                         recently used are disposed
```

Notes:

- **Zero initial VRAM.** Painting materials start with a shared 1×1 placeholder, and paintings stay invisible until
  their photo arrives, so unrevealed artwork uploads nothing. The velvet backer behind the painting is the
  loading placeholder.
- **No React re-renders while walking.** Proximity reads `localMotion.position` (`world/shared.js`) inside
  `useFrame`. React only hears about caption changes. (`localMotion` is the project's name for the local player's
  per-frame state; the brief calls it `local`.)
- **Frame-rate independent.** Curtain and fade use exponential damping (`damp` in `utils/math.js`, the same model
  as `maath/easing.damp`), with `dt` clamped to 0.1 s so a stalled tab resumes smoothly.
- **Hysteresis.** Opens inside 3.5 m and closes beyond 4.5 m, so it never flickers on the boundary.
- **Floors count.** Distance is horizontal on the same floor, plus 4 m for every metre of height difference beyond
  the first, so a balcony painting doesn't open for someone walking in the corridor underneath it.
- **Zone culling.** Once a frame hangs on its wall, the rooms it can be seen from are baked with physics rays. From
  any other room (and beyond 12 m), its instances are hidden, its photo isn't drawn, and it takes no spotlight. See
  [ROOMS.md](ROOMS.md#zone-culling-worldvisibilityjs-worldvisibilitybakejsx).
- **Cover crop.** Photos of any aspect ratio fill the painting without stretching (`fitCover`).

## The curtain

Each half is a 28×12 plane hanging from the rod. In the vertex shader:

- the cloth gathers toward its outer edge as `aOpen` rises, with the hem gathering a little less than the top,
  as real drapery does;
- pleat depth grows as it bunches (`0.03 m → 0.10 m`), with normals derived analytically, so lighting follows the folds;
- the inner hem lifts slightly, as if caught by a tie-back;
- a slow sway (1.2 cm at the hem) keeps it from looking frozen.

The right half is the same geometry mirrored by its instance matrix. All curtains share one draw call. There are no
curtain rings: the cloth hangs from a rod pocket, which reads the same at viewing distance and needs nothing to follow
the gathering cloth.

## Interaction

- **Proximity:** automatic, per player (not synced: each player sees curtains open around themselves).
- **Click:** with a free mouse, click the curtain (R3F `onClick` on an invisible hitbox). With the mouse locked for
  looking around, click anywhere: the gallery raycasts from the screen centre (crosshair) against the hitboxes only.
- **A click toggles a held state:** held open, or held closed (overriding proximity). It returns to automatic when
  the player who leaves walks beyond 12 m and the partner isn't near either.

## Multiplayer sync

| Event | Direction | Payload |
|---|---|---|
| `gallery:curtain` | client → server → partner | `{ id, open: true \| false \| null }` |
| `gallery:state` | server → joining or resuming client | `{ [id]: true \| false }` |

The server validates ids (`/^[\w-]{1,64}$/`), caps a room at 500 overrides, rate-limits each socket with a token
bucket (bursts of 20, 10 per second sustained), and remembers overrides per room, so a partner who joins later
or reconnects sees the same curtains. Only clicks are synced; proximity stays local, so walking around sends nothing.

## Rooms and categories

The 18 paintings are grouped by room, and the caption shows each one's category and room:

| Room | Category | Paintings |
|---|---|---|
| Study & Library | Early Days | 3 (west end wall, north wall) |
| Memory Corridor | Little Moments | 6 (both end walls, south wall) |
| Living Salon & Hearth | Milestones | 3 (north wall, east end wall) |
| Upper Sunset Balcony | Travels & Adventures | 6 (upper galleries, bridge wall) |

## Adding paintings

1. Put the image in `client/public/photos/` (KTX2 preferred; see `docs/PERFORMANCE.md` §4).
2. Add an entry to `photos.js` with its `room` and `category`. The anchor only needs to be close to a wall: each
   frame casts a physics ray at startup and hangs itself on the wall behind its anchor.
3. Choose spots where the wall is flat across the whole curtain (2.3 × 2.1 m) and visible from where people
   walk. Positions are written at the house's authored scale and multiplied by `MANSION_SCALE`. The spots in use
   were found by a search that tested a 7×5 grid of rays over each candidate frame for flatness (within 4 cm), checked
   that nothing stands proud of the wall behind the curtain, and checked line of sight from three standing spots 3 m out.

Hundreds of paintings cost: 2 draw calls for the batch, a few microseconds of JavaScript each per frame (one
distance check and two damped values; an estimate, not measured at that scale), 2 spotlights in total, and VRAM
only for photos that are revealed or still cached.
