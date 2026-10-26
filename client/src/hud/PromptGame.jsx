import { useEffect } from 'react';
import { endGame, promptCategory, promptNext, promptPick } from '../net/gameNet';
import { CATEGORIES, PROMPT_GAMES, generatePrompt } from '../games/prompts';
import { burstHearts } from '../world/reactions';
import { localMotion } from '../world/shared';
import { partner } from '../gallery/curtainState';

/** What the reveal means, in a line: for each game, from the point of view of this player. */
function verdict(kind, mine, theirs) {
  if (kind === 'nhie') {
    if (mine === 0 && theirs === 0) return 'You both have! Tell each other the story. 😄';
    if (mine === 0) return 'Only you have. Your partner wants the full story…';
    if (theirs === 0) return 'Only your partner has. Ask them about it!';
    return 'Neither of you has. Maybe one day, together?';
  }
  if (kind === 'wyr') return mine === theirs ? 'Same choice! Great minds. 💗' : 'Different choices. Time to defend yours!';
  // Who's More Likely To: "me" is 0, "my partner" is 1; you agree when you point at the same person.
  if (mine === theirs) return mine === 0 ? 'You each picked yourself. A tie!' : 'You each picked the other. Very sweet.';
  return mine === 0 ? 'You both say it is you! 💗' : 'You both say it is your partner! 💗';
}

/**
 * The panel for the three "both answer, then reveal" games. A prompt (from games/prompts.js, by the server's seed and
 * the chosen category) flips open on both screens; each of you answers in secret; when both have, the answers flip
 * over together with a line about what it means; Next deals another. The tally counts confessions (Never Have I
 * Ever) or agreement (the other two).
 */
export default function PromptGame({ game }) {
  const info = PROMPT_GAMES[game.kind];
  const prompt = generatePrompt(game.kind, game.seed, game.category);
  const { reveal } = game;

  useEffect(() => {
    document.exitPointerLock?.(); // the panel needs the mouse
  }, []);

  // Answer with 1 and 2 as well.
  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || reveal || game.myPick !== null || e.target.closest?.('input, textarea')) return;
      const n = ['Digit1', 'Digit2'].indexOf(e.code);
      if (n >= 0) promptPick(n);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game, reveal]);

  // A little celebration when you agree (or both confess).
  useEffect(() => {
    if (!reveal) return;
    const agree = game.kind === 'nhie' ? reveal.mine === 0 && reveal.theirs === 0 : game.kind === 'wyr' ? reveal.mine === reveal.theirs : reveal.mine !== reveal.theirs;
    if (!agree) return;
    burstHearts(localMotion.position.x, localMotion.position.y + 1.1, localMotion.position.z, 6);
    if (partner.known) burstHearts(partner.position.x, partner.position.y + 1.1, partner.position.z, 6);
  }, [reveal, game.kind]);

  const tally =
    game.kind === 'nhie'
      ? `Confessions: you ${game.tally.mine} · partner ${game.tally.theirs}`
      : `${game.kind === 'wyr' ? 'Same choice' : 'Agreed'} ${game.tally.matches} of ${game.tally.rounds}`;

  return (
    <div className="tod prompt-game" role="dialog" aria-label={info.title}>
      <div className="quiz-top">
        <span>{info.icon} {info.title} · round {game.round}</span>
        <span>{tally}</span>
        <button type="button" className="quiz-close" onClick={endGame} aria-label="End the game">×</button>
      </div>

      <div className="prompt-cats" role="radiogroup" aria-label="Category">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={game.category === c.id}
            className={game.category === c.id ? 'on' : ''}
            onClick={() => promptCategory(c.id)}
          >
            {c.icon} {c.label}
          </button>
        ))}
      </div>

      <div className="tod-card-wrap">
        <div className={`tod-card prompt-${game.kind}`} key={`${game.seed}-${game.category}`}>
          <div className="tod-card-back" aria-hidden="true">{info.icon}</div>
          <div className="tod-card-face">
            <div className="tod-card-label">{CATEGORIES.find((c) => c.id === prompt.category)?.label}</div>
            <p className="tod-card-text">{prompt.text}</p>
          </div>
        </div>
      </div>

      <div className="prompt-answers">
        {prompt.answers.map((text, i) => {
          const mine = reveal ? reveal.mine === i : game.myPick === i;
          const theirs = reveal && reveal.theirs === i;
          return (
            <button
              key={i}
              type="button"
              className={`prompt-answer${mine ? ' mine' : ''}${theirs ? ' theirs' : ''}`}
              disabled={game.myPick !== null || !!reveal}
              onClick={() => promptPick(i)}
            >
              <span>{text}</span>
              {reveal && (
                <span className="prompt-who">
                  {mine && theirs ? 'you both' : mine ? 'you' : theirs ? 'your partner' : ''}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {reveal ? (
        <div className="quiz-reveal">
          <p className="quiz-match">{verdict(game.kind, reveal.mine, reveal.theirs)}</p>
          <button type="button" onClick={promptNext}>Next ›</button>
        </div>
      ) : (
        <p className="quiz-wait">
          {game.myPick === null ? (game.partnerPicked ? 'Your partner has answered. Your turn!' : 'Answer in secret (1 or 2).') : 'Waiting for your partner…'}
        </p>
      )}
    </div>
  );
}
