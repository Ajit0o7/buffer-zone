# Memories: adding your own photos

The permanent paintings come from `client/src/gallery/photos.js`. **Add memory** (bottom right of the screen) lets
either player hang more photos while you are in the house. They appear on both screens, behind the same velvet
curtains, with a caption and a date.

## Using it

1. Press **Add memory**. The mouse is freed so you can use the form.
2. Choose a photo, or drop one on the box. The date starts from the file's own date; change it if you like.
3. Write a caption (up to 140 characters) and press **Hang it on the wall**.

Both of you see a note saying which room it was hung in. Walk up to its curtain to see it. **Remove**, in the same
form, takes a photo down for both of you and frees its place.

**It hangs where you are standing.** Every painting's curtain is a spot, plus 12 extra spots in the corridor and on the
balcony's galleries (`gallery/memorySlots.js`): 30 in all. When you add a photo, your browser lists the free spots
nearest you, with the painting whose curtain is open in front of you first, and the server hangs it on the first one
still free, so you both see it in the same place. A photo on a painting's spot takes that painting's place; take the
photo down and the painting comes back.

**Photos live in the server's memory with the room.** They stay while either of you is in the house (and for the
60 seconds the room is kept after you both leave, which is what lets a refresh or a dropped connection resume), then
they are gone. That matches the rest of the house, whose rooms and keys are temporary too. To keep photos for good, put
the permanent ones in `photos.js`, or give the server real storage (see [Making it permanent](#making-it-permanent)).

## What happens to a photo

```
your computer                                   server                         your partner
  pick file
  shrink to 1600 px, re-encode as WebP (JPEG
  where the browser can't). Location and camera
  data in the file do not survive this
  POST /api/rooms/:room/memories ─────────────► check the room token
   Authorization: Bearer <your room token>      read at most 1.5 MB, refuse the rest as it arrives
   X-Caption, X-Date                            look at the file's own first bytes: only WebP, JPEG, PNG
                                                clean the caption (no control characters, 140 max) and date
                                                keep it, give it a random 128-bit id and a wall spot
  both sockets: 'gallery:memory' ◄──────────────┴─────────────────────────────► 'gallery:memory'
  frame mounts on its spot                                                       frame mounts on its spot
  curtain opens near you: GET /api/rooms/:room/memories/:id ──► the bytes (WebGL texture, loaded on first reveal)
```

- **Textures are as lazy as the permanent paintings':** nothing is downloaded or uploaded to the GPU until a curtain
  first opens near you, and the texture cache's limits (at most 6 loaded, 128 MB) apply to memories too.
- **The id is the key.** A photo's address contains a 128-bit random id that only the two players are sent, so the file is
  readable by anyone who has that exact address and nobody else. Uploading needs the room token.
- **Limits:** 1.5 MB per photo, 30 per room (one per spot), 6 uploads a minute per room, 256 MB for the whole server. The browser also
  refuses to load an image wider or taller than 4096 pixels.

## How the gallery makes room for them

The gallery batch (`GalleryBatch.jsx`) is built once with a spare instance for each possible memory
(`GALLERY_CAPACITY` = one per spot: the paintings plus 12), so adding a photo needs no rebuild: its frame mounts on its slot's
instance, snaps to the wall with a physics ray like any other, bakes its zone visibility, and loads its photo on reveal.
Removing it hides that instance again. The two draw calls of the gallery don't change.

## Making it permanent

The server keeps photos in `server/src/rooms.js` (`addMemory`, `getMemory`). To keep them across restarts, write them
to disk or object storage (S3, Firebase Storage) in those two functions, keyed by room, and have the rooms' keys survive
too (they are in memory as well). The client doesn't need to change.

## Changing it

- **More or different spots:** `EXTRA_SLOTS` in `gallery/memorySlots.js` (authored-scale positions). Keep
  `MEMORY_SPOTS` (paintings + extra spots) equal to `MEMORY_SPOTS` in `server/src/rooms.js`. Frames snap onto the wall behind their
  anchor, so the anchor only has to be close.
- **Size and quality:** `MAX_SIDE` in `gallery/memoryNet.js` (1600 px) and the server's `MAX_MEMORY_BYTES`.
- **Another origin:** with `CLIENT_ORIGIN` unset the server accepts pages from localhost and private network addresses
  (so `http://192.168.x.x:5173` works too). For a deployment, set `CLIENT_ORIGIN` (comma-separated); the sockets and the
  upload route use the same list for CORS.
- **"Could not reach the house":** the upload never got an answer. Restart the server after updating (an older one
  has no upload route), and make sure the page and server are on the same machine or `VITE_SERVER_URL` points at it.
