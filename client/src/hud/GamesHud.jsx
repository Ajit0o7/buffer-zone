import { useEffect, useState } from 'react';
import { useGames } from '../state/games';
import { useSession } from '../state/session';
import { answerQuiz, endGame, nextQuestion, startGame } from '../net/gameNet';
import { HUNT_SPOTS } from '../games/hunt';
import { QUESTIONS, quizVerdict } from '../games/quiz';
import { localMotion } from '../world/shared';
import TruthOrDare from './TruthOrDare';

const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The Games menu (G): pick a game to play together. */
function Menu() {
  const peerConnected = useSession((s) => s.peerConnected);
  const game = useGames((s) => s.game);
  const close = () => useGames.getState().setMenuOpen(false);
  const start = (kind) => {
    startGame(kind);
    close();
  };
  return (
    <div className="games-menu" role="dialog" aria-label="Games">
      <h2>Play together</h2>
      <button type="button" className="game-card" onClick={() => start('hunt')}>
        <span className="game-icon" aria-hidden="true">💗</span>
        <strong>Heart Hunt</strong>
        <span>Ten golden hearts are hidden around the house. Find them all together, as fast as you can.</span>
      </button>
      <button type="button" className="game-card" onClick={() => start('quiz')} disabled={!peerConnected}>
        <span className="game-icon" aria-hidden="true">💬</span>
        <strong>How well do you know me?</strong>
        <span>{peerConnected ? 'Take turns: one answers about themselves, the other guesses. Eight questions.' : 'Needs your partner in the house.'}</span>
      </button>
      <button type="button" className="game-card" onClick={() => start('tod')} disabled={!peerConnected}>
        <span className="game-icon" aria-hidden="true">💌</span>
        <strong>Truth or Dare</strong>
        <span>{peerConnected ? 'Take turns. Sweet, deep and flirty truths; dares for photos, voice and real life. Endless cards.' : 'Needs your partner in the house.'}</span>
      </button>
      <div className="games-menu-actions">
        {game && (
          <button type="button" className="secondary" onClick={() => { endGame(); close(); }}>
            End the current game
          </button>
        )}
        <button type="button" className="secondary" onClick={close}>Close <kbd>G</kbd></button>
      </div>
    </div>
  );
}

/** Heart Hunt's status bar and, at the end, its celebration. */
function Hunt({ game, role }) {
  const receivedAt = useGames((s) => s.receivedAt);
  const [now, setNow] = useState(performance.now());
  const [nearest, setNearest] = useState(null);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(performance.now());
      // How far the nearest heart still out there is, for a gentle hint.
      let best = Infinity;
      for (const spot of game.spots) {
        if (game.found[spot]) continue;
        const h = HUNT_SPOTS[spot];
        const p = localMotion.position;
        best = Math.min(best, Math.hypot(h.x - p.x, h.z - p.z) + 4 * Math.max(0, Math.abs(h.floor + 0.9 - p.y) - 1));
      }
      setNearest(Number.isFinite(best) ? best : null);
    }, 400);
    return () => clearInterval(timer);
  }, [game]);

  const found = Object.values(game.found);
  const mine = found.filter((r) => r === role).length;
  const theirs = found.length - mine;
  const elapsed = game.finished ? game.elapsedMs : game.elapsedMs + (now - receivedAt);

  if (game.finished) {
    return (
      <div className="game-result" role="dialog" aria-label="Heart Hunt finished">
        <div className="game-result-hearts" aria-hidden="true">💗💗💗</div>
        <h2>You found all {game.spots.length} hearts together</h2>
        <p className="game-result-time">in {clock(elapsed)}</p>
        <p>You found {mine} · your partner found {theirs}</p>
        <div className="games-menu-actions">
          <button type="button" onClick={() => startGame('hunt')}>Play again</button>
          <button type="button" className="secondary" onClick={endGame}>Done</button>
        </div>
      </div>
    );
  }
  return (
    <div className="game-bar" role="status">
      <span className="game-bar-title">💗 Heart Hunt</span>
      <strong>{found.length} / {game.spots.length}</strong>
      <span>you {mine} · partner {theirs}</span>
      <span>{clock(elapsed)}</span>
      {nearest !== null && <span className="game-bar-hint">{nearest < 6 ? 'very close…' : nearest < 15 ? `nearest about ${Math.round(nearest)} m` : 'keep exploring'}</span>}
      <button type="button" className="game-bar-end" onClick={endGame}>End</button>
    </div>
  );
}

/** The quiz's panel: the question, four answers, the reveal, the score. */
function Quiz({ game, role }) {
  useEffect(() => {
    document.exitPointerLock?.(); // it needs the mouse
  }, []);
  // Answer with 1-4 too.
  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || game.done || game.reveal || game.myPick !== null) return;
      const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (n >= 0) answerQuiz(n);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);

  if (game.done) {
    return (
      <div className="quiz" role="dialog" aria-label="Quiz finished">
        <h2>{game.score.matches} out of {game.score.rounds}</h2>
        <p className="quiz-verdict">{quizVerdict(game.score.matches, game.score.rounds)}</p>
        <div className="games-menu-actions">
          <button type="button" onClick={() => startGame('quiz')}>Play again</button>
          <button type="button" className="secondary" onClick={endGame}>Done</button>
        </div>
      </div>
    );
  }

  const question = QUESTIONS[game.question];
  const aboutMe = game.about === role;
  const shown = game.reveal ?? null;
  return (
    <div className="quiz" role="dialog" aria-label="How well do you know me?">
      <div className="quiz-top">
        <span>Question {game.round + 1} of {game.rounds}</span>
        <span>{game.score.matches} matched</span>
        <button type="button" className="quiz-close" onClick={endGame} aria-label="End the quiz">×</button>
      </div>
      <p className="quiz-who">{aboutMe ? 'About you: answer honestly' : 'About your partner: guess their answer'}</p>
      <h2>{aboutMe ? 'Your' : "Your partner's"} {question?.thing}?</h2>
      <div className="quiz-answers">
        {question?.answers.map((text, i) => {
          const isAnswer = shown && shown.answer === i;
          const isGuess = shown && shown.guess === i;
          const cls = ['quiz-answer', game.myPick === i ? 'picked' : '', isAnswer ? 'right' : '', isGuess && !isAnswer ? 'wrong' : ''].join(' ');
          return (
            <button key={i} type="button" className={cls} disabled={game.myPick !== null || !!shown} onClick={() => answerQuiz(i)}>
              <kbd>{i + 1}</kbd> {text}
              {isAnswer && isGuess && <em>you both picked this</em>}
              {isAnswer && !isGuess && <em>{aboutMe ? 'your answer' : 'their answer'}</em>}
              {isGuess && !isAnswer && <em>{aboutMe ? 'their guess' : 'your guess'}</em>}
            </button>
          );
        })}
      </div>
      {shown ? (
        <div className="quiz-reveal">
          <p className={shown.match ? 'quiz-match' : 'quiz-miss'}>{shown.match ? (aboutMe ? 'They know you! 💗' : 'You know them! 💗') : 'Not quite!'}</p>
          <button type="button" onClick={nextQuestion}>{game.round + 1 < game.rounds ? 'Next question' : 'See the score'}</button>
        </div>
      ) : (
        <p className="quiz-wait">
          {game.myPick === null ? (game.partnerPicked ? 'Your partner has chosen. Your turn.' : 'Pick one.') : 'Waiting for your partner…'}
        </p>
      )}
    </div>
  );
}

/** Games: the menu, and whichever game is on. G opens the menu. */
export default function GamesHud() {
  const game = useGames((s) => s.game);
  const menuOpen = useGames((s) => s.menuOpen);
  const role = useSession((s) => s.role);

  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'KeyG' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.('input, textarea, select')) return;
      const open = !useGames.getState().menuOpen;
      useGames.getState().setMenuOpen(open);
      if (open) document.exitPointerLock?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      {game?.kind === 'hunt' && <Hunt game={game} role={role} />}
      {game?.kind === 'quiz' && <Quiz game={game} role={role} />}
      {game?.kind === 'tod' && <TruthOrDare game={game} role={role} />}
      {menuOpen && <Menu />}
    </>
  );
}
