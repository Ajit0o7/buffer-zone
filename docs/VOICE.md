# Voice chat

Talk to your partner as you walk through the house. Press **V** or the **Mic** button (bottom right) to turn your
microphone on or off. The voice is positioned in the house: it comes from where your partner is, gets quieter and duller
the farther away they are, and is muffled through a floor.

## Using it

- The first time, the browser asks to use your microphone. Allow it.
- The microphone is **off until you turn it on**, and turning it off releases it, so the browser's recording indicator
  goes out. You can hear your partner whenever *their* microphone is on.
- A ring around your button shows when you are being heard; "Your partner is speaking" shows when they are.
- Use headphones if you can. Echo cancellation is on, but a speaker next to a microphone is still the usual cause of echo.
- **It needs a secure page**: `https://`, or `localhost`. Browsers don't offer the microphone on a plain `http://` address.

## How it works

```
host                         game server                     guest
 offer ────────────────────► 'voice:signal' ───────────────► answer
 ICE candidates ◄──────────► relays only these messages ◄──► ICE candidates
 │                                                              │
 └──────────────── audio, peer to peer (WebRTC) ────────────────┘   the server never sees it
```

- **Signalling** goes over the existing socket: `voice:signal` carries `{ sid, kind: offer | answer | candidate | bye,
  data }`. The server validates and rebuilds every message (`sanitizeVoiceSignal`), caps their size, rate-limits each
  socket, and passes them to the partner only. It does nothing else with voice.
- **The call:** the host offers whenever the partner is in the room, and the guest answers (`audio/voiceNet.js`). Each
  side has one audio transceiver that is `sendrecv` from the start, so turning a microphone on or off is
  `replaceTrack()`, with no renegotiation. If the partner leaves and returns, the host starts a new call with a new
  session id; late messages from the old one are ignored. A failed connection triggers an ICE restart.
- **Positioning** (`audio/Voice.jsx`): the partner's stream goes through a low-pass filter, an HRTF panner and a gain
  into the same output as everything else, so the stone-hall reverb applies to voices too. The panner is placed at the
  partner's position *relative to the player*, around the camera, so distance is player-to-partner and direction is as the
  camera sees it. Over distance the voice fades (inverse, 1.5 m reference) and dulls (the filter closes from 14 kHz toward
  0.9 kHz); on another floor it is dulled further.
- **Speaking indicators** read the loudness of each stream with an analyser, report only when it changes (not per frame),
  and hold for 350 ms across pauses.

## Connecting through firewalls

Out of the box the game uses Google's public STUN server (`stun.l.google.com`), which lets two people behind ordinary
home routers connect directly. Some networks (offices, mobile carriers, strict NATs) block that, and need a **TURN** relay
to carry the audio. Set it in `client/.env.local` and rebuild:

```
VITE_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]
```

A TURN service is cheap and can be self-hosted ([coturn](https://github.com/coturn/coturn)) or rented. The relay sees only
encrypted audio (WebRTC encrypts end to end), but a TURN password in a client-side variable is visible to anyone who opens
the page, so use short-lived credentials if you publish the game.

## Privacy

Audio goes straight between the two browsers, encrypted (DTLS-SRTP). Your partner's browser learns your network address, as
in any peer-to-peer call. The server sees only the connection setup messages.
