# Audio

Four things make sound: the room music, footsteps (yours and your partner's), your partner's voice
([VOICE.md](VOICE.md)), and the stone-hall reverb that they all sit in. All of it lives in `client/src/audio/`.

## Footsteps

### When a step plays

A step plays when a foot lands, not on a timer. Each avatar watches its own ankles (`Avatar.jsx`): a foot has left the
ground once its ankle is 6 cm above its standing height, and has landed when it comes back within 2.5 cm of it. Landing
pushes an event to `world/footsteps.js`; `SpatialAudio.jsx` plays one sound per event, positioned where the foot came
down. Your partner's avatar is animated locally from their interpolated movement, so their steps are detected the same way
and line up with what you see.

Each step picks:

- a **surface**: stone, or carpet on the grand stair's red runner (and the strip on its landing);
- a **gait**: walk or run, from the speed;
- a **variant**: one of eight, never the same twice running for one foot, so a stride doesn't sound like a loop;
- a **pitch** (±6 %, a touch lower for the left foot), and a **volume** that rises with speed. Your own steps are quieter than
  your partner's, as they are in a real room.

Steps are positional (`PositionalAudio`): full volume within 2.5 m, then a firm falloff, so your partner's steps carry
down the nave but only murmur from the far end. A pool of eight sounds is shared by both players.

### What a step is made of (`footstepSynth.js`)

No recordings are shipped, so the steps are built from the parts of a real one. For stone:

| Layer | What it models | Sound |
|---|---|---|
| Heel strike | hard sole meeting the floor | 5 ms burst, 0.7-4.8 kHz, plus a brief click up to 7 kHz |
| Body | the sole and the slab giving the step weight | 15 ms burst, 220-900 Hz |
| Thud | slab taking the weight | damped 75-110 Hz tone that falls in pitch |
| Knock | sole and stone | damped 180-270 Hz tone |
| Tile ring | stone tile resonating | two faint, narrow tones at 1.1-1.8 kHz and 2.6-3.5 kHz |
| Toe | the forefoot coming down | softer, duller burst 85-120 ms later when walking, 25-45 ms when running (nearly merged) |
| Scuff | the sole settling | very faint hiss |

Carpet keeps only a muffled body, a soft thud and a soft toe. Every layer is randomised per variant (pitch, timing, level).

**Tuned by measurement, not by ear.** Hard-soled steps on stone sit around 2 kHz, with most of their audible energy between
1 and 4 kHz and some body below it. The first version came out 97 % below 250 Hz, a dull thump, because filtered noise is far
quieter than the same level of a tone; the balance was fixed by weighting each layer's spectrum the way the ear does
(A-weighting) and adjusting until it matched:

| | centre (A-weighted) | under 250 Hz | 250 Hz-1 kHz | 1-4 kHz | over 4 kHz |
|---|---|---|---|---|---|
| stone, walking | 2.0 kHz | 7 % | 17 % | 67 % | 10 % |
| stone, running | 1.8 kHz | 10 % | 24 % | 57 % | 9 % |
| carpet, walking | 0.8 kHz | 18 % | 57 % | 25 % | 1 % |

These numbers were not listened to: the sandbox can't play sound. If a step sounds too sharp or too dull on your speakers,
the knobs are the `gain` of each layer in `stone()` and `carpet()`.

### Using real recordings

Real recordings of footsteps will always beat synthesis. Put short clips (one step each, WAV or OGG, ideally 8-12 per surface)
in `client/public/audio/footsteps/` and list them in `world/config.js`:

```js
export const FOOTSTEP_SAMPLES = {
  stone: ['/audio/footsteps/stone-1.ogg', '/audio/footsteps/stone-2.ogg', /* ... */],
  carpet: ['/audio/footsteps/carpet-1.ogg', /* ... */],
};
```

Listed surfaces use the recordings (one picked at random per step, same pitch and volume variation); an empty list keeps
the synthesis. Check the licence of anything you download: CC0 packs from OpenGameArt or freesound.org are a good source.

## Reverb (`reverb.js`)

Everything audible goes through the listener's output, which feeds a convolution reverb alongside the dry sound. Its impulse
response is built in code: early reflections off the walls, then a dense tail that dies in about 3 s in the lows and 1.2 s in
the highs, as in a large stone room. The wet level follows the room you stand in: wettest in the atrium (0.24), drier on the
balcony (0.20), the corridor (0.14), and the small study and salon (0.10).

## Room music

Non-positional, with a level per room (`world/rooms.js`), crossfaded over 6 m at room edges. The music file is a placeholder:
replace `client/public/audio/romantic-theme.wav` with your own.
