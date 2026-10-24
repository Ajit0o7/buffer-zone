// Truth or Dare's endless deck. A card is made from a seed (the server picks it, so both screens show the same card):
// the seed chooses a vibe, a template and the words that fill its blanks, so the deck never runs out (tens of
// thousands of combinations) and rarely repeats.
//
// Truths come in three vibes: sweet & nostalgic, deep & emotional, flirty & playful.
// Dares are mostly for the real world, outside the house: photos to send, things to say on the mic (V), and
// sweet things to do; now and then one in the house itself.

/** A small, fast seeded random generator (mulberry32). */
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

// ---------------------------------------------------------------- words for the blanks

const MOMENTS = ['our first date', 'the first time we talked', 'the first time we held hands', 'our first trip together', 'the first time you met my friends', 'our first fight and how we made up', 'the first time I made you laugh', 'the first night we talked till morning'];
const TIMES = ['our first month', 'last year', 'a rainy day together', 'a lazy weekend', 'a festival we spent together', 'a late-night call', 'a walk we took', 'a meal we shared'];
const SENSES = ['a song', 'a smell', 'a food', 'a place', 'a film', 'a colour', 'a word', 'a season'];
const LITTLE_THINGS = ['the way I say your name', 'my laugh', 'the way I text', 'my bad jokes', 'the way I look at you', 'how I get sleepy', 'the faces I make when I concentrate', 'how I get excited about food'];
const YEARS = ['one year', 'five years', 'ten years', 'twenty years', 'fifty years'];
const FUTURE = ['our home', 'our weekends', 'our travels', 'our mornings', 'our anniversaries', 'growing old together', 'our family', 'the adventures we will have'];
const FEELINGS = ['safe', 'loved', 'proud', 'understood', 'missed', 'lucky', 'calm', 'excited'];
const WHENS = ['when I laugh', 'when I wake up', 'when I am concentrating', 'when I dress up', 'when I am sleepy', 'when I am being silly', 'when I talk about something I love', 'when I am a little jealous'];
const ADJECTIVES = ['flirty', 'sweet', 'honest', 'funny', 'romantic', 'cheeky'];
const PLACES = ['under the stars', 'in the rain', 'on a beach at sunset', 'in a quiet cafe', 'on a mountain top', 'in a crowded market', 'on a long train ride', 'in this very house'];
const NTH = ['3rd', '5th', '7th', '10th', '12th', '15th', '20th', '25th', '30th', '50th'];
const SELFIE_STYLES = ['exactly as you are right now, no filters', 'with your best smile', 'with your cutest pout', 'making a heart with your hands', 'pretending to be a model', 'with your sleepiest face', 'blowing me a kiss', 'with the silliest face you can make'];
const OBJECTS = ['something nearby that reminds you of me', 'the view from your window right now', 'your favourite mug', 'something you are wearing right now', 'the last thing you bought', 'your shoes', 'something blue near you', 'something that makes you smile', 'the snack closest to you', 'your favourite corner of your room', 'something you would give me as a gift', 'your hand making a heart over something pretty'];
const VOICES = ['a dramatic Bollywood hero', 'a nervous teenager', 'a movie villain', 'a news reporter', 'a pirate', 'a sleepy cat', 'an opera singer', 'a cartoon character', 'a very posh butler', 'a sports commentator'];
const SONGS = ['the first love song that comes to mind', 'our song', 'a Nepali love song', 'a Bollywood classic', 'a song that reminds you of me', 'a lullaby'];
const STORIES = ['the moment you knew you were falling for me', 'your favourite memory of us', 'what you thought the first time you saw me', 'the day you missed me the most', 'the moment you felt closest to me', 'a dream you had about us'];
const LETTERS = 'ABCDGHJKMPRS'.split('');
const PROMISES = ['for this week', 'for our next date', 'for our future', 'for the next time I am sad', 'for our next trip', 'that you have never made before'];
const COUNTS = ['three', 'four', 'five'];
const ACTIVITIES = ['dance in the kitchen', 'watch the sunrise', 'cook dinner together', 'get lost in a new city', 'stay in bed all day', 'go trekking', 'have a picnic by a lake', 'take a road trip with no plan', 'stargaze on a rooftop', 'go to a festival', 'have a movie marathon', 'take a cooking class', 'go on a boat ride', 'try street food all night', 'build a blanket fort', 'go to a fancy dinner', 'have a karaoke night', 'walk in the rain', 'visit your hometown', 'learn a dance together', 'go camping', 'spend a day at the beach', 'have a spa day', 'go to an amusement park'];
const SWEET_STEMS = ['The first time I saw you, I thought', 'I knew I liked you when', 'My favourite thing about our first date was', 'The moment I could not stop smiling was when you', 'A memory of us I will never forget is', 'You made me feel special the day you', 'The silliest thing we ever did together was', 'I still think about the time we'];
const DEEP_STEMS = ['I feel closest to you when', 'One thing I want us to always do is', 'I am grateful for you because', 'Something I have learned from you is', 'The future I imagine with you looks like', 'I feel most understood when you', 'One fear I have about us is', 'I promise that I will always'];
const FLIRTY_STEMS = ['You look the most attractive when', 'If I could kiss you right now, I would', 'The thing that makes me blush around you is', 'My favourite part of you is', 'If we were alone right now, I would', 'The sweetest thing you could whisper to me is', 'You drive me crazy when you', 'On our perfect date, you would be wearing'];
const SCENARIOS = ['we had one whole day with no phones', 'we won a free trip anywhere', 'we could live in any city for a year', 'we were stuck in a lift together for an hour', 'we met for the first time today', 'we could relive one day of our relationship', 'we had a house exactly like this one', 'we could only talk in song lyrics for a day'];
const TRUTH_TWISTS = ['Answer in exactly three words, then explain.', 'Answer, then ask me the same question.', 'Answer with a detail you have never shared before.', 'Answer while looking straight into the camera.', 'Give your answer a score out of 10, too.', 'Answer in your softest voice.', 'Answer, then tell me what you wish I would say back.', 'Take ten seconds to think before you answer.'];
const DARE_TWISTS = ['Do it in the next 60 seconds.', 'Bonus: add a heart emoji to every message you send for the next five minutes.', 'If you dare, do it twice.', 'Then I have to do the same back to you.', 'Do it with a straight face.', 'Make it as dramatic as you can.', 'Then tell me how it made you feel.', 'Do it while holding eye contact with the camera.'];
const SAY_THINGS = ['say "I love you"', 'propose to me', 'read out my name like a poem', 'describe what you are wearing', 'tell me good morning', 'ask me out on a date', 'apologise for stealing my heart', 'announce our anniversary'];
const PHOTO_STYLES = ['with a sweet caption', 'with a one-word caption that describes your mood', 'and say why you chose it', 'taken from the weirdest angle you can find', 'in black and white', 'with your hand in the frame'];
const TEXT_TOPICS = ['why you like me', 'our first date', 'what you are going to do on our next date', 'what you miss about me right now', 'your favourite thing about my face', 'how our future looks'];
const HOUSE_SPOTS = ['your favourite spot in the house', 'the fountain', 'the top of the grand staircase', 'the lounge sofa', 'the fireplace in the salon', 'the balcony bridge'];

// ---------------------------------------------------------------- templates: (pick) => text

const TRUTHS = {
  sweet: {
    label: 'Sweet & Nostalgic',
    icon: '🌸',
    make: [
      () => 'What was your very first impression of me?',
      () => 'When did you first feel butterflies around me?',
      (p) => `What is your favourite memory from ${p(TIMES)} with me?`,
      (p) => `What were you thinking during ${p(MOMENTS)}?`,
      (p) => `Which ${p(SENSES)} always reminds you of us, and why?`,
      (p) => `What do you secretly love about ${p(LITTLE_THINGS)}?`,
      () => 'What is the first message from me that you remember?',
      () => 'What little thing do I do that makes you smile every single time?',
      () => 'When did you first tell someone about me, and what did you say?',
      (p) => `If you could relive ${p(MOMENTS)}, what would you do differently?`,
      () => 'What is a photo of us you look at when you miss me?',
      () => 'What was the moment you realised I was special?',
      (p) => `Finish this sentence: "${p(SWEET_STEMS)}…"`,
      (p) => `Finish this sentence: "${p(SWEET_STEMS)}…"`,
      (p) => { const [a, b] = p.two(ACTIVITIES); return `Would you rather ${a} or ${b} with me, and why?`; },
    ],
  },
  deep: {
    label: 'Deep & Emotional',
    icon: '🌙',
    make: [
      () => 'What is one dream for our future you have never said out loud?',
      (p) => `When do you feel most ${p(FEELINGS)} with me?`,
      (p) => `Where do you see us in ${p(YEARS)}?`,
      (p) => `What do you imagine about ${p(FUTURE)}?`,
      () => 'What is something you are proud of me for?',
      () => 'What is one thing you would like us to do more often?',
      () => 'What worries you about the future, and how can I help with it?',
      () => 'What is something you have always wanted to tell me but never have?',
      () => 'What is a promise you would like me to make you?',
      () => 'How have I changed you since we met?',
      () => 'What do you need from me on your hardest days?',
      () => 'What does home mean to you, and is it a place or a person?',
      (p) => `Finish this sentence: "${p(DEEP_STEMS)}…"`,
      (p) => `Finish this sentence: "${p(DEEP_STEMS)}…"`,
      (p) => `What would you want us to do if ${p(SCENARIOS)}?`,
    ],
  },
  flirty: {
    label: 'Flirty & Playful',
    icon: '😘',
    make: [
      (p) => `What do you love most about the way I look ${p(WHENS)}?`,
      () => 'What nickname would you secretly love me to call you?',
      () => 'Which outfit of mine is your favourite?',
      (p) => `Describe me in three ${p(ADJECTIVES)} words.`,
      (p) => `If we were on a date ${p(PLACES)} right now, what would you whisper to me?`,
      () => 'What is the most attractive thing I do without realising?',
      () => 'What is the cheesiest pick-up line you would use on me?',
      () => 'When did you last check me out without me noticing?',
      () => 'What is your favourite compliment I have ever given you?',
      () => 'If you could kiss me anywhere in the world, where would it be?',
      () => 'What would our perfect lazy day in bed with snacks look like?',
      () => 'Which of my habits do you pretend to hate but secretly find cute?',
      (p) => `Finish this sentence: "${p(FLIRTY_STEMS)}…"`,
      (p) => `Finish this sentence: "${p(FLIRTY_STEMS)}…"`,
      (p) => { const [a, b] = p.two(ACTIVITIES); return `Would you rather ${a} or ${b} with me? Describe how it would go.`; },
    ],
  },
};

const DARES = {
  photo: {
    label: 'Photo dare',
    icon: '📸',
    weight: 0.34,
    make: [
      (p) => `Send me the ${p(NTH)} photo in your camera roll, and tell me the story behind it.`,
      (p) => `Send me a candid selfie ${p(SELFIE_STYLES)}.`,
      () => 'Screenshot your lock screen and send it to me.',
      (p) => `Send me a photo of ${p(OBJECTS)}.`,
      (p) => `Send me a photo of ${p(OBJECTS)}, ${p(PHOTO_STYLES)}.`,
      (p) => `Send me the ${p(NTH)} photo in your camera roll ${p(PHOTO_STYLES)}.`,
      () => 'Find the oldest photo of us on your phone and send it with a new caption.',
      () => 'Send me a photo you took today that you have not shown anyone.',
      () => 'Send me a photo of your hand, and I will send one of mine: then we put them side by side.',
      () => 'Send me your favourite photo of me and say why it is your favourite.',
    ],
  },
  voice: {
    label: 'Voice dare (mic on: V)',
    icon: '🎙️',
    weight: 0.33,
    make: [
      (p) => `Say "I love you" like ${p(VOICES)}.`,
      (p) => `On the mic, ${p(SAY_THINGS)} like ${p(VOICES)}.`,
      (p) => `On the mic, ${p(SAY_THINGS)} in the most romantic voice you have.`,
      (p) => `Whisper ${p(COUNTS)} sweet compliments about me into the mic.`,
      (p) => `Sing 10 seconds of ${p(SONGS)}.`,
      (p) => `Tell me the story of ${p(STORIES)}, in under a minute.`,
      () => 'Read your last text to me out loud in your most romantic voice.',
      (p) => `Describe our next date as ${p(VOICES)} would.`,
      () => 'Say good night to me as if it were our 50th anniversary.',
      () => 'Hum a tune and let me guess the song. If I get it, you owe me a kiss.',
    ],
  },
  real: {
    label: 'Real-world dare',
    icon: '💌',
    weight: 0.25,
    make: [
      () => 'Text me three sentences about how you feel about me, without using the word "love".',
      (p) => `Text me ${p(COUNTS)} sentences about ${p(TEXT_TOPICS)}, without using the word "love".`,
      (p) => `Send me a voice note about ${p(TEXT_TOPICS)}.`,
      (p) => `Put your hand on your heart and make me a promise ${p(PROMISES)}.`,
      (p) => `Invent a new sweet pet name for me that starts with the letter ${p(LETTERS)}, and use it for the rest of the game.`,
      (p) => `Give me ${p(COUNTS)} compliments in a row without repeating yourself.`,
      () => 'Write my name somewhere on your hand and send me a photo of it.',
      () => 'Plan our next date out loud in 60 seconds: where we go, what we eat, what we wear.',
      () => 'Send me a voice note I can listen to tomorrow morning.',
      () => 'Set a photo of us as your phone wallpaper for the next 24 hours, and show me.',
      () => 'Write a tiny four-line poem about us and read it to me.',
      () => 'Tell me one thing you will do this week just to make me smile, then do it.',
    ],
  },
  house: {
    label: 'In the house',
    icon: '🏰',
    weight: 0.08,
    make: [
      (p) => `Take my hand (H) and lead me to ${p(HOUSE_SPOTS)}. Then tell me why you chose it.`,
      () => 'Blow me three kisses in a row (press 2), each one more dramatic than the last.',
      () => 'Take a polaroid of the two of us (C) and send it to me.',
      () => 'Sit with me on the grand staircase (E) and tell me about your day.',
    ],
  },
};

/**
 * The card for `type` ('truth' | 'dare') and `seed`: { vibe, label, icon, text }. Pure: the same seed always gives
 * the same card, on both screens.
 */
export function generateCard(type, seed) {
  const r = rng(seed);
  const pick = (list) => list[Math.floor(r() * list.length)];
  pick.two = (list) => {
    const i = Math.floor(r() * list.length);
    const j = (i + 1 + Math.floor(r() * (list.length - 1))) % list.length; // never the same as i
    return [list[i], list[j]];
  };
  // Many cards get a twist on the end, which multiplies the deck again.
  const twist = (text, twists) => (r() < 0.4 ? `${text} ${pick(twists)}` : text);
  if (type === 'truth') {
    const vibe = pick(Object.keys(TRUTHS));
    const t = TRUTHS[vibe];
    return { vibe, label: t.label, icon: t.icon, text: twist(pick(t.make)(pick), TRUTH_TWISTS) };
  }
  let roll = r();
  let kind = 'real';
  for (const [k, d] of Object.entries(DARES)) {
    if (roll < d.weight) {
      kind = k;
      break;
    }
    roll -= d.weight;
  }
  const d = DARES[kind];
  return { vibe: kind, label: d.label, icon: d.icon, text: twist(pick(d.make)(pick), DARE_TWISTS) };
}
