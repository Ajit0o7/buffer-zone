// "How well do you know me?": each question is a thing about a person, shown as "Your …?" to the one it's about and
// "Your partner's …?" to the one guessing, with four answers. The server picks eight for a game, in random order.

const q = (thing, ...answers) => ({ thing, answers });

export const QUESTIONS = [
  q('perfect date night', 'A movie night at home', 'A candlelit dinner out', 'Dancing till late', 'Stargazing somewhere quiet'),
  q('favourite snack', 'Momo', 'Sel roti', 'Chatpate', 'Chocolate'),
  q('dream trip', 'Trekking in the mountains', 'A beach island', 'A big city abroad', 'A quiet village stay'),
  q('love language', 'Sweet words', 'Hugs and holding hands', 'Little gifts', 'Time together'),
  q('favourite season', 'Spring', 'Summer', 'Monsoon', 'Winter'),
  q('ideal lazy Sunday', 'Sleeping in', 'Cooking together', 'Out with friends', 'Binge-watching a show'),
  q('go-to comfort food', 'Dal bhat', 'Noodles', 'Pizza', "Aama's cooking"),
  q('favourite drink', 'Milk tea', 'Coffee', 'Lassi', 'Fresh juice'),
  q('biggest pet peeve', 'People being late', 'Loud chewing', 'A messy room', 'Slow replies'),
  q('ideal pet', 'A dog', 'A cat', 'A bird', 'No pets, thanks'),
  q('daily rhythm', 'Early bird', 'Night owl', 'Depends on the day', 'Always sleepy'),
  q('favourite kind of film', 'Romance', 'Comedy', 'Action', 'Horror'),
  q('dream home', 'A hilltop house with a view', 'A flat in the city', 'A cottage by a lake', 'A palace like this one'),
  q('dream superpower', 'Teleporting', 'Reading minds', 'Flying', 'Time travel'),
  q('way to make up after a fight', 'A long hug', 'Talking it through', 'Food as a peace offering', 'Space first, then talk'),
  q('favourite festival', 'Dashain', 'Tihar', 'Holi', 'New Year'),
  q('hidden talent', 'Singing', 'Cooking', 'Dancing', 'Making people laugh'),
  q('ideal anniversary gift', 'Jewellery', 'A handwritten letter', 'A surprise trip', 'Something homemade'),
  q('favourite colour', 'Red', 'Blue', 'Green', 'Black'),
  q('childhood dream job', 'Doctor', 'Pilot', 'Teacher', 'Film star'),
  q('favourite way to relax', 'Music', 'A long walk', 'A nap', 'Scrolling on the phone'),
  q('most-used emoji', '❤️', '😂', '🥺', '😘'),
  q('shopping style', 'Plans every purchase', 'Impulse buyer', 'Hates shopping', 'Window-shopper'),
  q('favourite time of day', 'Sunrise', 'Lazy afternoon', 'Sunset', 'Midnight'),
  q('karaoke song', 'A romantic ballad', 'A party anthem', 'An old classic', 'Absolutely no karaoke'),
  q('secret fear', 'Spiders', 'Heights', 'The dark', 'Being alone'),
  q('phone wallpaper', 'A photo of us', 'Nature', 'Family', 'Something random'),
  q('cooking skills', 'Chef level', 'Pretty good', 'Tea and noodles only', 'Kitchen disaster'),
  q('favourite way to travel', 'Plane', 'Train', 'Road trip', 'Motorbike'),
  q('ideal weekend getaway', 'Pokhara by the lake', 'A jungle safari', 'A spa day', 'Staying home together'),
  q('reaction to a surprise party', 'Happy tears', 'Loves every minute', 'Pretends to love it', 'Wants to run away'),
  q('dream wedding', 'A big traditional wedding', 'Small and intimate', 'A destination wedding', 'Simple, then a big party'),
]; // keep the count equal to QUIZ.questions in server/src/games.js

/** A verdict on the final score. */
export function quizVerdict(matches, rounds) {
  const share = rounds ? matches / rounds : 0;
  if (share === 1) return 'Soulmates. You know each other completely.';
  if (share >= 0.75) return 'You know each other so well.';
  if (share >= 0.5) return 'Pretty good. A few more date nights and you will ace it.';
  return 'Plenty still to learn about each other. That is the fun part.';
}
