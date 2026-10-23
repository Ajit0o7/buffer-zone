# Doing things together

Everything two people do together in the house: emotes, sitting, walking hand in hand and the photo camera.

## Keys

| Key | What it does |
|---|---|
| Mouse | Look around (click the view first). Left-right turns the camera, up-down tilts it; the wheel zooms |
| **1**–**6** | Emotes: wave, blow a kiss, heart, cheer, clap, laugh. Your partner sees them too |
| **E** | Sit on the seat in front of you (stair, benches, sofa, armchairs, piano bench); **E** or a move key stands up |
| **H** | Ask your partner to walk together; **H** on their side says yes; **H** again lets go |
| **C** | Photo mode: **Space** takes the picture, **C** goes back |
| **G** | Games: Heart Hunt, How well do you know me? |
| V / M | Microphone / Add a memory (see VOICE.md, MEMORIES.md) |

The emotes, Together and Photo are also buttons on the left-hand rail, and the microphone and Add memory on the right
(while the mouse is captured, press Esc to click them).

## Emotes

`avatar/emotes.js` lists them. Wave, cheer, clap and laugh are the avatar's own motion capture (Rocketbox clips built
into its file by `scripts/dress-avatars.py`), faded in over whatever it was doing. Blowing a kiss and the heart are arm
poses built in code (`avatar/couplePose.js`, two-bone IK in `avatar/ik.js`), and both send up floating hearts
(`scene/Reactions.jsx`, one draw call). Walking cancels an emote; the kiss and the heart also work sitting down.
The server relays only emote names it knows (`server/src/validate.js`).

## Sitting

Seats are listed in `world/seats.js`: three pairs on the grand stair, the courtyard bench by the fountain, two benches on
the east bridge, and the lounge's sofa, armchairs and piano bench (`scene/Lounge.jsx`). Each names where the pelvis goes,
the way it faces and where to stand up. The avatar's pelvis height is measured from its own sit clip
(`avatar/contacts.js measureSeated`), so both avatars sit on the surface. Standing up checks there is room (in front,
beside, or back where you sat down from), so you can never end up inside a wall. Your partner sees the seated pose
(the `sit` animation is synced), and a seat they're on is taken.

## Walking together

The host always leads. Either player presses H to ask, the other presses H to accept (both asking at once is a yes).
The guest's character then walks itself: it keeps to the host's right-hand side, 0.78 m away, matching the host's
speed and closing gaps (`avatar/LocalPlayer.jsx`); if it falls more than 6 m behind or gets stuck it is brought
along. Nobody runs while together, and the arms next to each other reach for a point between you
(`couplePose.js`), so you hold hands. Sitting down, H, or a partner leaving ends it.

## Photo mode

C hides the HUD and orbits the camera round the midpoint of the two of you (mouse to circle, wheel to zoom), with
depth of field focused there. The view renders at your screen's full pixel density, and the shutter takes the
picture at 2.5×. It comes out as a square vintage instant print (warm, faded, vignetted, with a caption of the room
and the date; `photo/polaroid.js`) that you can download.

## Games (G)

The server keeps each room's game (`server/src/games.js`), so both of you always see the same thing and a reconnect
picks it up again.

**Heart Hunt.** Ten golden hearts are hidden around the house, picked from 24 places (`client/src/games/hunt.js`):
the courtyard, the lounge's corners, both aisles, the salon by the hearth, halfway up the grand stair, the landing,
the bridge and both upper galleries. Walk into one to collect it; it pops with a chime for both of you. The bar at the
top shows how many are left, who found what, the time and a hint ("very close…"). Find the last one and a card shows
your time together. It works alone too.

**How well do you know me?** Eight questions (from 32 in `client/src/games/quiz.js`). Each round is about one of
you: they answer honestly about themselves, the other guesses. The server keeps the answer secret until both have
picked, then reveals both. Turns alternate; at the end you get your score and a verdict. Answer with the mouse or
keys 1–4.
