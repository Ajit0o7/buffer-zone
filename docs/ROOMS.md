# The rooms

The house is Khronos Sponza scaled 1.5× (`MANSION_SCALE`): an open nave with an arcaded aisle on each side, upper
galleries above the aisles, and a bridge across the east end. `world/rooms.js` divides it into five rooms.

| Room | Where | Theme on its walls | Paintings | Practical lights |
|---|---|---|---|---|
| **Grand Atrium** | the nave; both players spawn here, at its west end | the grand stair | 0 | lanterns on the stair's newel posts |
| **Memory Corridor** | the south aisle, end to end | Little Moments | 6 | two candelabra |
| **Study & Library** | the north aisle, west half | Early Days | 3 | two brass floor lamps |
| **Living Salon & Hearth** | the north aisle, east half | Milestones | 3 | the hearth (flickering) |
| **Upper Sunset Balcony** | the upper galleries and the east bridge | Travels & Adventures | 6 | lanterns on the bridge, two lamps on the galleries |

Rooms are axis-aligned boxes holding the player's capsule centre, checked in priority order: the balcony (anything above
4.6 m) first, so it wins over the ground-floor rooms beneath it. Each room has:

- **`music`**: the background-music level inside it, crossfaded over 6 m at its edges (`musicLevelAt`).
- **`name`**: shown on the HUD for a few seconds when you walk in, and under each painting's caption.

## The grand stair (`scene/GrandStair.jsx`)

Sponza has no stair: its upper floor is unreachable. The east bridge (floor at 4.99 m) is cut off from the nave by a
balustrade (top at 6.1 m) under a two-arched opening. So the stair rises along the middle of the nave and steps over it:

```
 nave floor 0 m                              landing 6.25 m          bridge 4.99 m
 x = 0.08 ──── 35 risers × 17.9 cm, 28 cm treads ────► 9.6 ── over the balustrade ── 11.5 ──► 7 risers down ──► 13.3
 2.6 m wide, carpet runner, balustrades both sides      4.25 m wide, through either arch
```

- **Collision:** one convex ramp through the middle of every tread, the landing slab, a ramp down onto the bridge, and
  rails along every open edge. The character controller climbs it as a 32° slope (under its 35° slide limit), so there is
  no step bobbing for the camera, and feet stay within half a riser (9 cm) of each tread. Exact foot placement needs IK
  (see the README roadmap).
- **Drawing:** every step, carpet strip, baluster, rail and newel post is an instance of one box: one draw call. Stone parts
  take the house's own floor texture in world space (`scene/stone.js`), so they match the building.
- **Walk-tested:** from the nave (capsule centre 0.89 m) to the landing (7.17 m), through the north arch, and onto the
  bridge (5.91 m).

## Practical lights (`scene/Practicals.jsx`)

Each room's lamps, candles, lanterns and hearth are listed in `PRACTICALS` (`world/rooms.js`) with a position, colour,
intensity and optional flicker. They share **a fixed pool of three point lights**:

1. Every frame, the practicals that can be seen from the viewer's rooms (see zone culling below) and lie within 13 m are
   ranked by distance; the nearest three are wanted.
2. Each practical fades its level toward 1 if wanted, 0 if not (about half a second), and the pool lights the three
   brightest. Lights change hands smoothly, and the scene's light count never changes, so no shader ever recompiles.
3. Each pool light reaches 10 m (`distance`), so it costs nothing beyond that, and none casts shadows: the follow-sun stays
   the only shadow-casting light.

The props are boxes and glowing icosahedra in two instanced meshes (two draw calls for all of them). Glowing parts use
instance colours above 1, which the bloom pass picks up, so a lamp still glows from across the house after its real light
has gone to a nearer one.

## Zone culling (`world/visibility.js`, `world/VisibilityBake.jsx`)

When the house loads, each room is sampled with physics rays: a grid of standing spots 1.5 m apart, at eye height (1.7 m)
and follow-camera height (3.3 m). Then, for every painting (centre and four curtain corners) and every practical light, the
bake asks which rooms have a clear line of sight from any standing spot. It runs in 2 ms slices, so loading never hitches;
until a target is baked it is treated as visible.

Each frame, the viewer's rooms are the player's room and the camera's room. A painting that can't be seen from them has its
batched parts hidden and draws no photo; a light that can't be seen gets no pool light, and its props are hidden. Paintings
within 12 m are always drawn, so a coarse sample never makes a nearby painting pop.

Sponza is one open courtyard, so most rooms can see into most others and the bake culls modestly: the balcony and the bridge
hide some aisle paintings and lights, and vice versa. In a house with real walls and doors, the same mechanism culls most of
the house.

## Changing the layout

- **Rooms:** edit the boxes in `ROOMS` (at the house's authored scale). Keep the balcony first.
- **Lights:** add to `PRACTICALS`; `kind` is `hearth`, `lamp`, `candles`, `newels` or `lanterns`.
- **Paintings:** see [GALLERY.md](GALLERY.md#adding-paintings). Each has a `room` and a `category`.
- **A different house:** the stair is fitted to Sponza's east bridge (`LANDING` in `GrandStair.jsx`). For another model,
  set the landing to sit over its balustrade, and re-run the wall search for the paintings.
