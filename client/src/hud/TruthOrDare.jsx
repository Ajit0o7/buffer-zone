import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioContext } from 'three';
import { endGame, todAdd, todDone, todPick, todReroll, todWild } from '../net/gameNet';
import { generateCard } from '../games/truthOrDare';
import { playFanfare } from '../audio/chime';
import { burstHearts } from '../world/reactions';
import { localMotion } from '../world/shared';
import { partner } from '../gallery/curtainState';

const PIECES = ['💗', '💖', '💕', '🌸', '✨', '❤️', '🌹'];

/** Hearts and petals drifting down over the screen, for a card well done. Remounted (by key) each time. */
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        id: i,
        char: PIECES[i % PIECES.length],
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        duration: 2.4 + Math.random() * 1.8,
        size: 0.9 + Math.random() * 1.3,
        drift: (Math.random() - 0.5) * 30,
        spin: (Math.random() - 0.5) * 720,
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            left: `${p.left}%`,
            fontSize: `${p.size}rem`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            '--drift': `${p.drift}vw`,
            '--spin': `${p.spin}deg`,
          }}
        >
          {p.char}
        </span>
      ))}
    </div>
  );
}

/** What the card says, and the line above it. */
function describe(card, myTurn) {
  if (card.source === 'deck') return generateCard(card.type, card.seed);
  if (card.source === 'custom') {
    return { icon: '🤫', label: myTurn ? 'A secret card from your partner' : 'Your secret card!', text: card.text };
  }
  return { icon: '🃏', label: myTurn ? "Wildcard: your partner's choice" : 'Your wildcard', text: card.text };
}

/** Writing a secret card into the deck, for your partner to draw one day. */
function AddCard({ game }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('truth');
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const add = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    todAdd(type, text);
    setText('');
    setSent(true);
    setTimeout(() => setSent(false), 1800);
  };
  return (
    <div className="tod-add">
      <button type="button" className="tod-add-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? '−' : '+'} Add a secret card for your partner
        <span className="tod-add-count">
          {game.myCards} of yours waiting · {game.partnerCards} of theirs
        </span>
      </button>
      {open && (
        <form onSubmit={add} className="tod-add-form">
          <div className="tod-type">
            {['truth', 'dare'].map((t) => (
              <button key={t} type="button" className={type === t ? 'on' : ''} onClick={() => setType(t)}>
                {t === 'truth' ? 'Truth' : 'Dare'}
              </button>
            ))}
          </div>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder={type === 'truth' ? 'A question only you would ask…' : 'Something sweet for them to do…'} aria-label="Your secret card" />
          <button type="submit" disabled={!text.trim()}>{sent ? 'Added 🤫' : 'Add'}</button>
        </form>
      )}
    </div>
  );
}

/**
 * Truth or Dare, turn by turn. Whoever's turn it is picks; the card flips open on both screens; they can re-roll it;
 * Done (either of you) sets off confetti on both screens and passes the turn. Cards come from an endless generator
 * (games/truthOrDare.js), from the secret cards the partner wrote, or are wildcards the partner writes on the spot.
 */
export default function TruthOrDare({ game, role }) {
  const myTurn = game.turn === role;
  const [wildText, setWildText] = useState('');
  const [party, setParty] = useState(0); // confetti key
  const lastCelebrate = useRef(game.celebrate);

  useEffect(() => {
    document.exitPointerLock?.(); // the game needs the mouse
  }, []);

  // A card was done: confetti, a fanfare and hearts round you both, on both screens.
  useEffect(() => {
    if (game.celebrate === lastCelebrate.current) return;
    lastCelebrate.current = game.celebrate;
    setParty((n) => n + 1);
    playFanfare(AudioContext.getContext());
    burstHearts(localMotion.position.x, localMotion.position.y + 1.1, localMotion.position.z, 10);
    if (partner.known) burstHearts(partner.position.x, partner.position.y + 1.1, partner.position.z, 10);
    const t = setTimeout(() => setParty(0), 4500);
    return () => clearTimeout(t);
  }, [game.celebrate]);

  const card = game.card;
  const face = card && card.text !== null ? describe(card, myTurn) : null;
  const cardKey = card ? `${card.source}-${card.seed ?? card.text}` : 'none';

  return (
    <>
      {party > 0 && <Confetti key={party} />}
      <div className="tod" role="dialog" aria-label="Truth or Dare">
        <div className="quiz-top">
          <span>Truth or Dare 💌 · round {game.round}</span>
          <span className={`tod-turn${myTurn ? ' mine' : ''}`}>{myTurn ? 'Your turn' : "Partner's turn"}</span>
          <button type="button" className="quiz-close" onClick={endGame} aria-label="End the game">×</button>
        </div>

        {game.phase === 'choose' && (
          myTurn ? (
            <div className="tod-choose">
              <button type="button" className="tod-pick truth" onClick={() => todPick('truth')}>
                <span aria-hidden="true">🌙</span>Truth
              </button>
              <button type="button" className="tod-pick dare" onClick={() => todPick('dare')}>
                <span aria-hidden="true">🔥</span>Dare
              </button>
            </div>
          ) : (
            <div className="tod-choose waiting">
              <div className="tod-pick truth" aria-hidden="true"><span>🌙</span>Truth</div>
              <div className="tod-pick dare" aria-hidden="true"><span>🔥</span>Dare</div>
              <p className="quiz-wait">Your partner is choosing…</p>
            </div>
          )
        )}

        {game.phase === 'wild' && (
          myTurn ? (
            <div className="tod-card-wrap">
              <div className="tod-card wild" key="wild-wait">
                <div className="tod-card-label">🃏 Wildcard!</div>
                <p className="tod-card-text">Your partner is writing a {card.type} just for you…</p>
              </div>
            </div>
          ) : (
            <form
              className="tod-wild"
              onSubmit={(e) => {
                e.preventDefault();
                if (wildText.trim()) todWild(wildText);
                setWildText('');
              }}
            >
              <p className="quiz-who">🃏 Wildcard! You choose.</p>
              <h2>Write a {card.type} for your partner</h2>
              <input value={wildText} onChange={(e) => setWildText(e.target.value)} maxLength={200} autoFocus placeholder={card.type === 'truth' ? 'Ask them anything…' : 'Dare them to…'} aria-label={`Your ${card.type}`} />
              <button type="submit" disabled={!wildText.trim()}>Send it</button>
            </form>
          )
        )}

        {game.phase === 'card' && face && (
          <>
            <div className="tod-card-wrap">
              <div className={`tod-card ${card.type}`} key={cardKey}>
                <div className="tod-card-back" aria-hidden="true">{card.type === 'truth' ? 'Truth' : 'Dare'}</div>
                <div className="tod-card-face">
                  <div className="tod-card-label">
                    {card.type === 'truth' ? 'Truth' : 'Dare'} · {face.icon} {face.label}
                  </div>
                  <p className="tod-card-text">{face.text}</p>
                  <p className="tod-card-for">{myTurn ? 'for you' : 'for your partner'}</p>
                </div>
              </div>
            </div>
            <div className="games-menu-actions">
              {myTurn && (
                <button type="button" className="secondary" onClick={todReroll}>Re-roll ↻</button>
              )}
              <button type="button" onClick={todDone}>Done ❤️</button>
            </div>
          </>
        )}

        <AddCard game={game} />
      </div>
    </>
  );
}
