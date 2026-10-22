// Your photos. Drop each image in client/public/photos/ and describe it here.
// position: wall-anchor in metres. rotation: Euler [x, y, z]; the frame faces its local +Z axis.
// Tip: export images as 2048px-wide WebP or KTX2 for fast loading.
export const PHOTOS = [
  {
    id: 'first-trip',
    src: '/photos/first-trip.webp',
    caption: 'The first trip, somewhere with no signal',
    date: '2019-06-14',
    position: [-5.95, 1.6, -8],
    rotation: [0, Math.PI / 2, 0],
  },
  {
    id: 'rainy-kitchen',
    src: '/photos/rainy-kitchen.webp',
    caption: 'Burnt pancakes and a rainy Sunday',
    date: '2021-03-07',
    position: [0, 1.6, -11.95],
    rotation: [0, 0, 0],
  },
  {
    id: 'the-yes',
    src: '/photos/the-yes.webp',
    caption: 'The moment you said yes',
    date: '2024-09-21',
    position: [-11.95, 1.6, 1],
    rotation: [0, Math.PI / 2, 0],
  },
];
