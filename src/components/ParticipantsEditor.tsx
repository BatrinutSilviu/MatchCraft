import { useRef, useState } from 'react';

interface Props {
  entries: string[];
  onChange: (entries: string[]) => void;
  noun: string;
}

/** Ordered list of participants; the order is the seeding. */
export function ParticipantsEditor({ entries, onChange, noun }: Props) {
  const [draft, setDraft] = useState('');
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const lower = noun.toLowerCase();
  const taken = new Set(entries.map((e) => e.trim().toLowerCase()));
  const duplicate = draft.trim() !== '' && taken.has(draft.trim().toLowerCase());

  const add = () => {
    const v = draft.trim();
    if (!v || duplicate) return;
    onChange([...entries, v]);
    setDraft('');
    addRef.current?.focus();
  };

  const addPasted = () => {
    const seen = new Set(taken);
    const fresh = pasteText.split(/\r?\n|,|;/).map((s) => s.trim()).filter((s) => {
      const k = s.toLowerCase();
      if (!s || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    onChange([...entries, ...fresh]);
    setPasteText('');
    setPasting(false);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= entries.length || from === to) return;
    const list = [...entries];
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    onChange(list);
  };

  const edit = (i: number, v: string) => onChange(entries.map((e, j) => (j === i ? v : e)));
  const remove = (i: number) => onChange(entries.filter((_, j) => j !== i));

  return (
    <div className="card p-editor">
      <div className="p-add">
        <input
          ref={addRef} value={draft} autoFocus placeholder={`Add a ${lower}, then press Enter`}
          aria-label={`New ${lower} name`} aria-invalid={duplicate}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <button type="button" className="btn btn-primary" onClick={add} disabled={!draft.trim() || duplicate}>Add</button>
      </div>
      {duplicate && <p className="warn small">That name is already on the list.</p>}

      {entries.length === 0 ? (
        <div className="p-empty">
          <span className="p-empty-icon">👥</span>
          <strong>No {lower}s yet</strong>
          <span className="muted small">Add them one by one above, paste a whole list, or start with placeholders.</span>
        </div>
      ) : (
        <ol className="p-list">
          {entries.map((e, i) => (
            <li
              key={i}
              className={`p-row ${dragFrom === i ? 'dragging' : ''}`}
              draggable
              onDragStart={(ev) => { setDragFrom(i); ev.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(ev) => { ev.preventDefault(); if (dragFrom !== null && dragFrom !== i) { move(dragFrom, i); setDragFrom(i); } }}
              onDragEnd={() => setDragFrom(null)}
            >
              <span className="p-handle" aria-hidden>⠿</span>
              <span className={`p-seed ${i < 3 ? `top top-${i + 1}` : ''}`} title={`Seed ${i + 1}`}>{i + 1}</span>
              <input value={e} onChange={(ev) => edit(i, ev.target.value)} aria-label={`Seed ${i + 1} name`} />
              <div className="p-actions">
                <button type="button" className="icon-btn" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Move up">↑</button>
                <button type="button" className="icon-btn" onClick={() => move(i, i + 1)} disabled={i === entries.length - 1} aria-label="Move down">↓</button>
                <button type="button" className="icon-btn" onClick={() => remove(i)} aria-label={`Remove ${e || 'entry'}`}>✕</button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {pasting ? (
        <div className="p-paste stack-sm">
          <textarea
            className="names" rows={6} value={pasteText} autoFocus
            onChange={(ev) => setPasteText(ev.target.value)}
            placeholder={`One per line, or separated by commas:\n${noun} A\n${noun} B`}
          />
          <div className="row end">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setPasting(false); setPasteText(''); }}>Cancel</button>
            <button type="button" className="btn btn-sm btn-primary" onClick={addPasted} disabled={!pasteText.trim()}>Add to list</button>
          </div>
        </div>
      ) : (
        <button type="button" className="chip" onClick={() => setPasting(true)}>📋 Paste a list</button>
      )}
    </div>
  );
}
