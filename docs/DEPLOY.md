# Putting it online

The game is two parts, hosted in two places:

| Part | Where | Why |
|---|---|---|
| Client (`client/`): the web page, models, photos | **Vercel** (static site) | Fast CDN, free |
| Server (`server/`): rooms, movement, voice signalling, uploads | **Render** (web service) | It keeps WebSocket connections open for as long as you play, which Vercel's serverless functions can't do |

## 1. The server on Render

1. Sign in at [render.com](https://render.com) with GitHub.
2. **New > Blueprint**, pick this repository. Render reads `render.yaml` at its root and sets everything up:
   `server/` as a Node web service, `npm ci --omit=dev` to build, `node src/index.js` to start, a health check on `/health`.
3. Check the `CLIENT_ORIGIN` value it offers: it must be your Vercel address (no trailing slash). The default is
   `https://privatespace-chi.vercel.app,https://privatespace-*.vercel.app` (the second covers Vercel's preview builds).
4. **Apply**. When the deploy finishes, open `https://<your-service>.onrender.com/health`: it should say `ok`.
   Copy that address (without `/health`).

The region is Singapore in `render.yaml`; change it before the first deploy if you're elsewhere.

**The free plan sleeps** after 15 minutes with no visitors, and the first visit afterwards takes up to a minute while it
wakes (the lobby says so and keeps trying). The paid "starter" plan stays awake. Rooms and the photos you add live in
the server's memory, so a sleep or a redeploy empties them (docs/MEMORIES.md).

## 2. The client on Vercel

1. In your Vercel project, **Settings > Environment Variables**, add `VITE_SERVER_URL` = your Render address, e.g.
   `https://our-house-server.onrender.com` (no trailing slash), for Production (and Preview, if you use previews).
2. **Redeploy** (Deployments > the latest > Redeploy). Vite writes the address into the page when it builds, so the
   variable only takes effect on a new build.

The build itself is the repository's `npm run build` (it builds `client/`); the output directory is `client/dist`.

## 3. Check

Open your Vercel address, **Create room**: the key card appears. Open the invite link in another browser: both of you
are in. If the lobby keeps saying it can't reach the house:

- `https://<your-service>.onrender.com/health` doesn't say `ok`: the server isn't running; see its logs on Render.
- It says `ok`, but the page still can't connect: `VITE_SERVER_URL` is missing or wrong in Vercel (redeploy after
  fixing it), or `CLIENT_ORIGIN` on Render doesn't match the page's address exactly (`https://`, no trailing slash).

Voice chat works between most home networks with the default STUN server; on strict networks add a TURN server
(`VITE_ICE_SERVERS`, docs/VOICE.md).
