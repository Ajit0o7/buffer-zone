import { useEffect, useRef, useState } from 'react';
import { socket } from '../net/socket';
import { useMemories } from '../state/memories';
import { useSession } from '../state/session';
import { MAX_MEMORIES } from '../gallery/memorySlots';
import { errorText, prepareImage, removeMemory, uploadMemory } from '../gallery/memoryNet';

const today = () => new Date().toISOString().slice(0, 10);
const fileDate = (file) => (file?.lastModified ? new Date(file.lastModified).toISOString().slice(0, 10) : today());

/**
 * "Add memory": pick or drop a photo, give it a caption and a date, and it is hung on the next free
 * spot on the walls for both of you. Also lists what has been added, so a photo can be taken down again.
 */
export default function MemoryModal({ onClose }) {
  const memories = useMemories((s) => s.list);
  const peerConnected = useSession((s) => s.peerConnected);
  const [prepared, setPrepared] = useState(null); // { blob, width, height, url }
  const [caption, setCaption] = useState('');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef();
  const dialog = useRef();

  // Free the mouse so the form can be used, and close on Escape.
  useEffect(() => {
    document.exitPointerLock?.();
    dialog.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => () => prepared && URL.revokeObjectURL(prepared.url), [prepared]);

  const choose = async (file) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const result = await prepareImage(file);
      setPrepared({ ...result, url: URL.createObjectURL(result.blob) });
      setDate(fileDate(file));
    } catch (err) {
      setError(errorText(err.code));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!prepared) return;
    setBusy(true);
    setError(null);
    try {
      await uploadMemory({ blob: prepared.blob, caption, date });
      onClose();
    } catch (err) {
      setError(errorText(err.code));
      setBusy(false);
    }
  };

  const full = memories.length >= MAX_MEMORIES;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="memory-title" tabIndex={-1} ref={dialog}>
        <h2 id="memory-title">Add a memory</h2>
        <p className="modal-note">
          It hangs on the walls for both of you, behind a curtain. {peerConnected ? '' : 'Your partner will see it when they arrive. '}
          Photos stay in the house until you both leave.
        </p>

        <form onSubmit={submit}>
          <div
            className={`drop${dragging ? ' over' : ''}${prepared ? ' has-image' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              choose(e.dataTransfer.files?.[0]);
            }}
          >
            {prepared ? (
              <img src={prepared.url} alt="Preview of the photo you chose" />
            ) : (
              <span>Drop a photo here, or</span>
            )}
            <button type="button" onClick={() => fileInput.current.click()} disabled={busy || full}>
              {prepared ? 'Choose another' : 'Choose a photo'}
            </button>
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => choose(e.target.files?.[0])} />
          </div>

          <label htmlFor="memory-caption">Caption</label>
          <input id="memory-caption" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={140} placeholder="The day we…" autoComplete="off" />

          <label htmlFor="memory-date">Date</label>
          <input id="memory-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} max={today()} required />

          {full && <p role="alert" className="error">The walls are full. Remove a memory below to make room.</p>}
          {error && <p role="alert" className="error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={!prepared || busy || full}>{busy ? 'Working…' : 'Hang it on the wall'}</button>
          </div>
        </form>

        {memories.length > 0 && (
          <section className="memory-list" aria-label="Memories you have added">
            <h3>Added so far ({memories.length}/{MAX_MEMORIES})</h3>
            <ul>
              {memories.map((m) => (
                <li key={m.id}>
                  <span>{m.caption || 'A new memory'}</span>
                  <button type="button" className="secondary" onClick={() => removeMemory(socket, m.id)}>Remove</button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
