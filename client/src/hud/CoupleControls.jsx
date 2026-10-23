import { useEffect } from 'react';
import { useCouple, couple, togglePhotoMode } from '../world/couple';
import { useSession } from '../state/session';
import { EMOTE_IDS, EMOTES } from '../avatar/emotes';
import { sendEmote, toggleTogether } from '../net/coupleNet';

const EMOTE_ICON = { wave: '👋', kiss: '💋', heart: '❤️', cheer: '🎉', clap: '👏', laugh: '😄' };

/**
 * Everything two people do together, on keys: 1-6 emotes, E to sit or stand, H to walk hand in hand, C for the
 * camera. The keys matter because, while the mouse is captured for looking around, clicks go to the 3D view,
 * so the buttons can only be clicked after pressing Esc (same reason as V and M).
 */
export default function CoupleControls({ disabled }) {
  const peerConnected = useSession((s) => s.peerConnected);
  const { together, seatPrompt, seated } = useCouple();

  useEffect(() => {
    const onKey = (e) => {
      if (disabled || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.('input, textarea, select')) return;
      const emote = EMOTE_IDS.find((id) => e.code === `Digit${EMOTES[id].key}` || e.code === `Numpad${EMOTES[id].key}`);
      if (emote) sendEmote(emote);
      else if (e.code === 'KeyE') couple.sitPressed = true;
      else if (e.code === 'KeyH') toggleTogether();
      else if (e.code === 'KeyC') togglePhotoMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disabled]);

  const prompt = seated
    ? 'Press E to stand up'
    : seatPrompt
      ? `Press E to sit ${seatPrompt.label}`
      : null;
  const togetherText = {
    invited: 'Your partner would like to walk together: press H',
    asked: 'Waiting for your partner to say yes… press H to cancel',
    on: 'Walking together: press H to let go',
  }[together];

  return (
    <>
      {(togetherText || prompt) && (
        <div className="couple-prompts" role="status">
          {togetherText && <p className={`prompt together-${together}`}>{togetherText}</p>}
          {prompt && <p className="prompt">{prompt}</p>}
        </div>
      )}
      <div className="emote-bar" role="toolbar" aria-label="Emotes and togetherness" aria-orientation="vertical">
        {EMOTE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className="emote"
            data-label={EMOTES[id].label}
            aria-label={`${EMOTES[id].label} (${EMOTES[id].key})`}
            onClick={() => sendEmote(id)}
            disabled={seated && !EMOTES[id].seated}
          >
            <span aria-hidden="true">{EMOTE_ICON[id]}</span>
            <kbd>{EMOTES[id].key}</kbd>
          </button>
        ))}
        <span className="emote-sep" aria-hidden="true" />
        <button
          type="button"
          className={`emote${together === 'on' ? ' on' : ''}${together === 'invited' ? ' ask' : ''}`}
          onClick={toggleTogether}
          disabled={!peerConnected}
          data-label={together === 'on' ? 'Let go' : 'Walk together'}
          aria-label="Walk together, hand in hand (H)"
          aria-pressed={together === 'on'}
        >
          <span aria-hidden="true">🤝</span>
          <kbd>H</kbd>
        </button>
        <button type="button" className="emote" onClick={togglePhotoMode} data-label="Photo mode" aria-label="Photo mode (C)">
          <span aria-hidden="true">📷</span>
          <kbd>C</kbd>
        </button>
      </div>
    </>
  );
}
