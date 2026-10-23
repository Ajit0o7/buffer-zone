// The emotes, in the order of the 1-6 keys. `clip` ones play the avatar's own motion capture; the others
// (kiss, heart) are arm poses built in code (avatar/couplePose.js), because the motion-capture library has
// no clip for them. `seated: true` ones can be done sitting down.
export const EMOTES = {
  wave: { label: 'Wave', key: '1', clip: 'wave', maxSeconds: 3.4 },
  kiss: { label: 'Blow a kiss', key: '2', seconds: 2.6, seated: true },
  heart: { label: 'Heart', key: '3', seconds: 3.2, seated: true },
  cheer: { label: 'Cheer', key: '4', clip: 'cheer', maxSeconds: 3.6 },
  clap: { label: 'Clap', key: '5', clip: 'clap', maxSeconds: 3.4 },
  laugh: { label: 'Laugh', key: '6', clip: 'laugh', maxSeconds: 3.8 },
};
export const EMOTE_IDS = Object.keys(EMOTES);
export const EXTRA_CLIPS = ['sit', 'wave', 'cheer', 'clap', 'laugh']; // optional clips in an avatar's file
