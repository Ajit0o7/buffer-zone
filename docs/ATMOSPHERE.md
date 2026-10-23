# The look of the house

The house is Sponza, a palace with an open courtyard down its middle. These pieces turn it into a warm, lived-in
palazzo at golden hour. Positions are in world metres; the courtyard's measurements are in `world/canopy.js`.

| Piece | File | Draw calls | Notes |
|---|---|---|---|
| Sunset sky | `scene/Sky.jsx` | 1 | Honey horizon, blush rose, dusky violet, the sun and thin clouds, all in one shader |
| Golden sun | `world/config.js` `SUN` | — | Low in the west, 33° up, honey gold; a warm hemisphere fill |
| Glass roof, chandeliers, fairy lights | `scene/Canopy.jsx` | 8 | Two gilded crystal chandeliers on chains from the ridge; festoons along the balustrades and across |
| Sunbeams | `scene/LightShafts.jsx` | 1 | Additive shafts along the sun's direction with drifting dust; off in the low tier |
| Rose petals | `scene/Petals.jsx` | 1 | Drifting down through the courtyard; off in the low tier |
| Marble floor | `scene/MarbleFloor.jsx` | 2 | Procedural veined marble; real reflections in high and cinematic, gloss only in medium and low |
| Lounge | `scene/Lounge.jsx` | ~13 | Persian rug, velvet Chesterfield, armchairs, marble table with candles, grand piano; all seats |
| Fountain | `scene/Fountain.jsx` | 4 | Marble basin with two tiers, rippling water, falling streams, spray and a trickle sound |
| Greenery | `scene/Greenery.jsx` | 10–20 | Ivy and wisteria from the balustrades, olive trees and figs in urns, roses and hydrangeas; each leaf kind split into 8 areas so what's off screen is culled |
| Contact shadows | `scene/GroundShadows.jsx` | 1 | Soft patches under furniture, the fountain, benches, pots, stands and lamps, so nothing hovers |
| Hearth | `scene/HearthFX.jsx` | 1 | Rising embers and a synthesized crackling fire in the salon |
| Gallery dressing | `gallery/GalleryBatch.jsx` | +2 | Moulded gilt frames, brass picture lights that glow as a curtain opens, engraved brass plaques |

Light: the chandeliers borrow from the pool of three practical point lights (`scene/Practicals.jsx`, with a longer
reach), so the light count never changes. The house still casts no shadows; only the avatars and a few pieces of
furniture do.

Photos on the walls are drawn unlit at 78% white: after ACES tone mapping their colours come out close to the
original, and their highlights stay under the bloom threshold.

## Cost

A frame in the courtyard at the high tier is about 165 draw calls: about 83 for the view, 60 for the floor's mirror,
and the rest for bloom and the final pass. Things that cost calls or triangles but hardly show in a floor reflection
(leaves and flowers, crystals, chain links, the photos, particles, sunbeams) are on a second render layer the mirror
camera doesn't see (`world/layers.js`). When the frame rate dips, the governor lowers resolution first, then turns off
the mirror (medium), then bloom and decoration (low); see PERFORMANCE.md.
