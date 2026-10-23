import { useEffect } from 'react';
import { useVoice } from '../state/voice';
import { useSession } from '../state/session';
import { toggleMic } from '../audio/voiceNet';

const MIC_ERRORS = {
  blocked: 'The microphone is blocked. Allow it in the address bar, then try again.',
  none: 'No microphone found.',
  busy: 'The microphone is in use by another app.',
  insecure: 'Voice needs a secure page (https://), or localhost.',
};

/**
 * Voice and "Add memory" buttons, bottom right. V toggles the microphone and M opens the Add memory form. The
 * keys matter because, while the mouse is captured for looking around, clicks go to the 3D view, so these
 * buttons can only be clicked after pressing Esc.
 */
export default function Toolbar({ onAddMemory }) {
  const peerConnected = useSession((s) => s.peerConnected);
  const { status, micOn, micError, speakingSelf, speakingPeer } = useVoice();

  useEffect(() => {
    const onKey = (e) => {
      if ((e.code !== 'KeyV' && e.code !== 'KeyM') || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.('input, textarea, select')) return;
      if (e.code === 'KeyV') toggleMic();
      else onAddMemory();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAddMemory]);

  const label = !peerConnected ? 'Waiting for your partner' : status === 'connected' ? 'Connected' : status === 'failed' ? 'Could not connect' : 'Connecting…';

  return (
    <div className="toolbar">
      {micError && <p role="alert" className="toolbar-error">{MIC_ERRORS[micError]}</p>}
      <div className="toolbar-row">
        {speakingPeer && <span className="speaking" aria-live="polite">Your partner is speaking</span>}
        <button
          type="button"
          className={`tool${micOn ? ' on' : ''}${speakingSelf ? ' talking' : ''}`}
          onClick={toggleMic}
          aria-pressed={micOn}
          title={`Voice chat: ${label}. Press V.`}
        >
          <span className="tool-icon" aria-hidden="true">{micOn ? '●' : '○'}</span>
          {micOn ? 'Mic on' : 'Mic off'} <kbd>V</kbd>
        </button>
        <button type="button" className="tool" onClick={onAddMemory}>
          <span className="tool-icon" aria-hidden="true">+</span>
          Add memory <kbd>M</kbd>
        </button>
      </div>
    </div>
  );
}
