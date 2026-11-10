import { useState } from 'react';
import type { Branding, Sponsor, Tournament } from '../types';
import { useStore, type Change } from '../store';
import { brandStyle, imageToDataUrl } from './Brand';

const SWATCHES = ['#0b8f5e', '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#0f172a'];

export function BrandingEditor({ t, onUpdate }: { t: Tournament; onUpdate: (c: Change) => Promise<boolean> }) {
  const { billing, askUpgrade } = useStore();
  const [draft, setDraft] = useState<Branding>(() => structuredClone(t.branding ?? {}));
  const [error, setError] = useState('');
  const locked = billing.enabled && !t.pro;
  const dirty = JSON.stringify(draft) !== JSON.stringify(t.branding ?? {});

  const upload = async (file: File | undefined, apply: (url: string) => void) => {
    if (!file) return;
    try {
      apply(await imageToDataUrl(file));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That image could not be used.');
    }
  };
  const sponsors = draft.sponsors ?? [];
  const setSponsor = (i: number, patch: Partial<Sponsor>) =>
    setDraft({ ...draft, sponsors: sponsors.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const save = () => {
    const clean: Branding = {
      accent: draft.accent || undefined,
      logo: draft.logo || undefined,
      sponsors: sponsors
        .map((s) => ({ name: s.name.trim(), logo: s.logo || undefined, url: s.url?.trim() || undefined }))
        .filter((s) => s.name),
    };
    const bad = clean.sponsors!.find((s) => s.url && !/^https?:\/\//i.test(s.url));
    if (bad) return setError(`The link for ${bad.name} must start with https://`);
    if (!clean.sponsors!.length) delete clean.sponsors;
    setError('');
    if (locked) return askUpgrade({ tournamentId: t.id, reason: 'Branding and sponsors are part of Pro.' });
    void onUpdate((cur) => ({ ...cur, branding: Object.keys(JSON.parse(JSON.stringify(clean))).length ? clean : undefined }));
  };

  return (
    <section className="card stack" style={brandStyle(draft)}>
      <div className="row between wrap">
        <div>
          <h3>Branding & sponsors {locked && <span className="pill">Pro</span>}</h3>
          <p className="muted small">Shown on the public page and the TV screen.</p>
        </div>
      </div>

      <div className="brand-grid">
        <div className="field">
          <span>Colour</span>
          <div className="row wrap">
            {SWATCHES.map((c) => (
              <button
                key={c} type="button" className={`swatch ${draft.accent === c ? 'on' : ''}`} style={{ background: c }}
                onClick={() => setDraft({ ...draft, accent: c })} aria-label={`Use ${c}`}
              />
            ))}
            <input type="color" value={draft.accent ?? '#0b8f5e'} onChange={(e) => setDraft({ ...draft, accent: e.target.value })} aria-label="Custom colour" />
            {draft.accent && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDraft({ ...draft, accent: undefined })}>Default</button>}
          </div>
        </div>
        <div className="field">
          <span>Logo</span>
          <div className="row">
            {draft.logo ? <img className="brand-logo" src={draft.logo} alt="" width={48} height={48} /> : <span className="t-emoji">{t.emoji}</span>}
            <label className="btn btn-sm">
              Upload
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void upload(e.target.files?.[0], (logo) => setDraft({ ...draft, logo }))} />
            </label>
            {draft.logo && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDraft({ ...draft, logo: undefined })}>Remove</button>}
          </div>
        </div>
      </div>

      <div className="stack-sm">
        <span className="field-label">Sponsors</span>
        {sponsors.map((s, i) => (
          <div key={i} className="sponsor-row">
            <label className="sponsor-logo-pick" title="Upload logo">
              {s.logo ? <img src={s.logo} alt="" /> : <span>＋ logo</span>}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void upload(e.target.files?.[0], (logo) => setSponsor(i, { logo }))} />
            </label>
            <input value={s.name} placeholder="Name" maxLength={80} onChange={(e) => setSponsor(i, { name: e.target.value })} aria-label="Sponsor name" />
            <input value={s.url ?? ''} placeholder="https://… (optional)" onChange={(e) => setSponsor(i, { url: e.target.value })} aria-label="Sponsor link" />
            <button type="button" className="icon-btn" onClick={() => setDraft({ ...draft, sponsors: sponsors.filter((_, j) => j !== i) })} aria-label={`Remove ${s.name || 'sponsor'}`}>✕</button>
          </div>
        ))}
        {sponsors.length < 12 && (
          <button type="button" className="chip" onClick={() => setDraft({ ...draft, sponsors: [...sponsors, { name: '' }] })}>＋ Add sponsor</button>
        )}
      </div>

      {error && <p className="error small">{error}</p>}
      <div className="row end">
        <button className="btn btn-primary btn-sm" disabled={!dirty} onClick={save}>{locked ? 'Save (needs Pro)' : 'Save branding'}</button>
      </div>
    </section>
  );
}
