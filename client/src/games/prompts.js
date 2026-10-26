// Endless prompts for the "both answer, then reveal" games: Never Have I Ever, Would You Rather, Who's More Likely To.
// A prompt is made from a seed and a category (the server picks the seed, so both screens show the same one): the
// seed chooses a template and the words in its blanks, so the decks never run out.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CATEGORIES = [
  { id: 'mix', label: 'Mix', icon: '🎲' },
  { id: 'sweet', label: 'Sweet', icon: '🌸' },
  { id: 'funny', label: 'Funny', icon: '😂' },
  { id: 'adventure', label: 'Adventure', icon: '🌍' },
  { id: 'flirty', label: 'Flirty', icon: '😘' },
];

// ---------------------------------------------------------------- words for the blanks

const W = {
  people: ['a friend', 'my mum', 'my best friend', 'a stranger', 'my sibling', 'a colleague'],
  places: ['a wedding', 'the cinema', 'a family dinner', 'a party', 'a temple', 'the office', 'a bus', 'a restaurant'],
  foods: ['momo', 'pizza', 'chocolate', 'ice cream', 'sel roti', 'instant noodles', 'pani puri', 'cake'],
  times: ['at 3 a.m.', 'on a first date', 'in the middle of an exam', 'on my birthday', 'on a work call', 'during a festival'],
  feelings: ['nervous', 'jealous', 'shy', 'giddy', 'homesick', 'starstruck'],
  trips: ['a trek', 'a road trip', 'a flight', 'a boat ride', 'a camping trip', 'a train journey'],
  things: ['a love letter', 'a poem', 'a song', 'a diary entry', 'a long text', 'a voice note'],
  dares: ['jumped into a cold lake', 'eaten something I could not name', 'ridden a motorbike', 'gone paragliding', 'slept under the stars', 'hitchhiked'],
  silly: ['talked to a plant', 'practised a speech in the mirror', 'danced alone in my room', 'pretended to be on the phone to avoid someone', 'laughed at my own joke before finishing it', 'sung in the shower loud enough for the neighbours'],
  dates: ['a candlelit dinner', 'a picnic by the lake', 'a movie night at home', 'dancing till midnight', 'a sunrise hike', 'a street-food crawl', 'a cooking night', 'stargazing on a rooftop', 'a museum date', 'a spa day'],
  powers: ['read minds', 'teleport', 'fly', 'stop time', 'talk to animals', 'be invisible'],
  forevers: ['only eat momo', 'only wear one colour', 'never use social media', 'always be ten minutes late', 'only speak in song lyrics', 'never feel cold'],
  homes: ['a cottage in the mountains', 'a flat in a busy city', 'a house by the sea', 'a farm in the countryside', 'a houseboat', 'a palace like this one'],
  trips2: ['backpack across Asia', 'spend a month in Paris', 'trek to Everest base camp', 'live on a tropical island', 'take a train across Europe', 'go on a safari'],
  romance: ['get a surprise love letter', 'get a surprise trip', 'slow dance in the kitchen', 'watch the sunset together', 'cuddle all day', 'have a midnight picnic'],
  silly2: ['have spaghetti for hair', 'sneeze glitter', 'hiccup every time you lie', 'have a theme song play when you walk in', 'only whisper', 'laugh like a goat'],
  likely: ['cry at a sad movie', 'forget an anniversary', 'get lost with a map in hand', 'fall asleep first on a movie night', 'start a dance party', 'eat the last piece without asking', 'plan a surprise', 'say "I love you" first after a fight', 'get us lost on a trip', 'befriend a stranger', 'spend all our money on food', 'take a hundred photos of the same view', 'laugh at the wrong moment', 'text back instantly', 'cry at our wedding', 'win an argument', 'say sorry first', 'adopt a stray animal', 'become famous', 'sing in public', 'burn dinner', 'want to go home early from a party', 'remember every little date', 'write a love song', 'propose in public', 'cancel plans to stay in bed'],
};

Object.assign(W, {
  keepsakes: ['a ticket', 'a receipt', 'a dried flower', 'a note', 'a photo', 'a wrapper', 'a text screenshot', 'a gift tag'],
  ourMoments: ['our first date', 'our first trip', 'the day we met', 'our first festival together', 'our first movie together', 'a day out with you'],
  thoughtsOf: ['you', 'your smile', 'our first kiss', 'our future', 'your voice', 'what you were doing'],
  whens: ['during a boring meeting', 'in the middle of the night', 'while you were talking', 'in the shower', 'on the bus', 'while someone else was talking to me', 'during class', 'while cooking'],
  outdoorActs: ['danced', 'had a picnic', 'watched the sunrise', 'got completely lost', 'fallen asleep', 'sung at the top of my voice', 'made a wish', 'cried happy tears'],
  outdoorPlaces: ['in the rain', 'on a rooftop', 'on a mountain', 'on a beach', 'in a forest', 'on a boat', 'in another country', 'at a festival'],
  forgets: ['an anniversary', 'their keys', 'where they parked', 'a birthday', 'their phone at a restaurant', 'what we were arguing about', 'the plot of a film halfway through', 'to reply to a message'],
  cryAt: ['a sad film', 'an advert', 'a wedding', 'a song', 'a dog video', 'a birthday card', 'the end of a series', 'a sunset'],
  spend: ['all our money on food', 'a whole day in bed', 'an hour choosing an outfit', 'a fortune on gifts', 'the night talking', 'all weekend gaming'],
  doPublic: ['sing', 'dance', 'cry', 'propose', 'fall over', 'start a conversation with a stranger', 'laugh out loud', 'take a hundred selfies'],
});

const pick2 = (r, list) => {
  const i = Math.floor(r() * list.length);
  const j = (i + 1 + Math.floor(r() * (list.length - 1))) % list.length;
  return [list[i], list[j]];
};

// ---------------------------------------------------------------- Never Have I Ever

const NHIE = {
  sweet: [
    (p) => `written ${p(W.things)} I never sent.`,
    () => 'kept something you gave me just because it reminded me of you.',
    () => 'replayed one of our conversations in my head for days.',
    () => 'smiled at my phone in public because of a message from you.',
    (p) => `told ${p(W.people)} all about you before we were even together.`,
    () => 'saved a screenshot of something sweet you said.',
    () => 'planned what I would say to you in front of the mirror.',
    () => 'looked at old photos of us just to feel close to you.',
    (p) => `felt ${p(W.feelings)} the first time we met.`,
    (p) => `kept ${p(W.keepsakes)} from ${p(W.ourMoments)}.`,
    (p) => `thought about ${p(W.thoughtsOf)} ${p(W.whens)}.`,
    (p) => `smiled about ${p(W.ourMoments)} ${p(W.whens)}.`,
  ],
  funny: [
    (p) => `${p(W.silly)}.`,
    (p) => `eaten ${p(W.foods)} ${p(W.times)}.`,
    (p) => `fallen asleep at ${p(W.places)}.`,
    (p) => `laughed so hard at ${p(W.places)} that I had to leave.`,
    () => 'waved back at someone who was waving at someone else.',
    () => 'sent a text to the wrong person.',
    () => 'pretended to know a song and made up the words.',
    () => 'walked into a glass door.',
    (p) => `got caught ${p(['singing', 'dancing', 'talking to myself', 'making faces'])} ${p(W.times)}.`,
  ],
  adventure: [
    (p) => `${p(W.dares)}.`,
    (p) => `got lost on ${p(W.trips)}.`,
    (p) => `missed ${p(['a flight', 'a train', 'a bus', 'a ferry'])} and had to improvise.`,
    () => 'travelled somewhere without a plan.',
    () => 'tried a food I could not pronounce.',
    () => 'watched the sunrise from a mountain.',
    (p) => `said yes to ${p(W.trips)} the same day it was planned.`,
    () => 'stayed awake all night just to see the stars.',
    (p) => `${p(W.outdoorActs)} ${p(W.outdoorPlaces)}.`,
    (p) => `${p(W.outdoorActs)} ${p(W.outdoorPlaces)}.`,
  ],
  flirty: [
    () => 'stared at your lips while you were talking.',
    () => 'dressed up just because I knew I would see you.',
    () => 'rehearsed a flirty line and then chickened out.',
    () => 'thought about kissing you in the middle of a serious conversation.',
    (p) => `blushed because of you ${p(W.times)}.`,
    () => 'reread our old chats late at night.',
    () => 'pretended to be busy so I would not seem too eager to reply.',
    () => 'worn something of yours just because it smelled like you.',
    () => 'imagined our wedding.',
    (p) => `daydreamed about kissing you ${p(W.whens)}.`,
    (p) => `checked my phone for your message ${p(W.whens)}.`,
    (p) => `missed you so much ${p(W.whens)} that I had to text you.`,
  ],
};

// ---------------------------------------------------------------- Would You Rather (two answers)

const WYR = {
  sweet: [
    (r) => pick2(r, W.dates).map((d) => `go on ${d}`),
    (r) => pick2(r, W.romance),
    (r) => pick2(r, W.homes).map((h) => `live in ${h} together`),
    () => ['get a handwritten letter from me every month', 'get a surprise date from me every month'],
    () => ['relive our first date', 'skip ahead to see our 50th anniversary'],
  ],
  funny: [
    (r) => pick2(r, W.silly2),
    (r) => pick2(r, W.forevers),
    () => ['always have to sing instead of talk', 'always have to dance instead of walk'],
    () => ['have a tiny dragon as a pet', 'have a giant hamster as a pet'],
    (r) => { const [a, b] = pick2(r, W.foods); return [`give up ${a} forever`, `give up ${b} forever`]; },
  ],
  adventure: [
    (r) => pick2(r, W.trips2),
    (r) => pick2(r, W.powers).map((x) => `be able to ${x}`),
    () => ['travel the world for a year with no money', 'stay home with all the money in the world'],
    () => ['explore the deep sea together', 'explore outer space together'],
    (r) => pick2(r, W.dares.map((d) => d.replace('jumped', 'jump').replace('eaten', 'eat').replace('ridden', 'ride').replace('gone', 'go').replace('slept', 'sleep').replace('hitchhiked', 'hitchhike'))).map((d) => `${d} with me`),
  ],
  flirty: [
    () => ['get a surprise kiss in public', 'get a slow kiss in private'],
    () => ['have me whisper something sweet in your ear', 'have me write it on a note for you to find'],
    () => ['a lazy morning cuddling in bed', 'a late night dancing close'],
    (r) => pick2(r, W.dates).map((d) => `go on ${d} with me tonight`),
    () => ['see me in a suit or sari', 'see me in my comfiest pyjamas'],
  ],
};

// ---------------------------------------------------------------- Who's More Likely To

const MLT_BY = {
  sweet: ['plan a surprise', 'say "I love you" first after a fight', 'remember every little date', 'cry at our wedding', 'write a love song', 'say sorry first', 'adopt a stray animal'],
  funny: ['fall asleep first on a movie night', 'eat the last piece without asking', 'laugh at the wrong moment', 'burn dinner', 'start a dance party', 'sing in public', 'get lost with a map in hand'],
  adventure: ['get us lost on a trip', 'befriend a stranger', 'take a hundred photos of the same view', 'spend all our money on food', 'become famous', 'cancel plans to stay in bed'],
  flirty: ['propose in public', 'text back instantly', 'start a kiss', 'steal the blanket', 'get jealous', 'flirt to get out of trouble', 'fall for the other first'],
};

/**
 * The prompt for a game kind ('nhie' | 'wyr' | 'mlt'), seed and category: { category, text, answers: [a, b] }.
 * Pure: the same inputs always give the same prompt.
 */
export function generatePrompt(kind, seed, category = 'mix') {
  const r = rng(seed);
  const p = (list) => list[Math.floor(r() * list.length)];
  const cat = category === 'mix' ? p(['sweet', 'funny', 'adventure', 'flirty']) : category;
  if (kind === 'nhie') {
    // Sometimes a little ending that changes the question.
    let line = p(NHIE[cat])(p);
    if (r() < 0.35) line = `${line.replace(/\.$/, '')} ${p(['before we met', 'and kept it a secret', 'more than once', 'this year', 'and told you about it', 'and loved it'])}.`;
    return { category: cat, text: `Never have I ever ${line}`, answers: ['🙋 I have', '🙅 Never'] };
  }
  if (kind === 'wyr') {
    const [a, b] = p(WYR[cat])(r);
    return { category: cat, text: 'Would you rather…', answers: [a.charAt(0).toUpperCase() + a.slice(1), b.charAt(0).toUpperCase() + b.slice(1)] };
  }
  // A ready-made line, or one put together from a verb and its object.
  const built = [
    () => `forget ${p(W.forgets)}`,
    () => `cry at ${p(W.cryAt)}`,
    () => `spend ${p(W.spend)}`,
    () => `${p(W.doPublic)} in public`,
    () => `eat ${p(W.foods)} ${p(W.times)}`,
    () => `get ${p(W.feelings)} ${p(W.times)}`,
    () => `${p(W.doPublic)} at ${p(W.places)}`,
    () => `plan ${p(['a surprise party', 'a secret trip', 'a picnic', 'a candlelit dinner', 'a treasure hunt', 'a movie night', 'a weekend away'])} for ${p(['a birthday', 'our anniversary', 'no reason at all', 'a rainy day', 'a Monday', "Valentine's Day", 'a festival'])}`,
    () => `fall asleep ${p(['during a film', 'on a long drive', 'mid-sentence', 'at a party', 'on a video call', 'in the bath', 'at the dinner table'])}`,
    () => `text ${p(W.people)} about ${p(['our date', 'our fight', 'something cute you said', 'what to get you as a gift', 'our future', 'a dream about you'])}`,
  ];
  const roll = r();
  const thing = roll < 0.35 ? p(MLT_BY[cat]) : roll < 0.5 ? p(W.likely) : p(built)();
  return { category: cat, text: `Who's more likely to ${thing}?`, answers: ['👈 Me', '👉 My partner'] };
}

export const PROMPT_GAMES = {
  nhie: { title: 'Never Have I Ever', icon: '🙋', blurb: 'Both answer in secret, then reveal. Confessions welcome.' },
  wyr: { title: 'Would You Rather', icon: '⚖️', blurb: 'Two choices, one answer each. Do you think alike?' },
  mlt: { title: "Who's More Likely To", icon: '👉', blurb: 'Point at yourself or your partner. Do you agree?' },
};
