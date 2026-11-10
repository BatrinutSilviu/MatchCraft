import type { CSSProperties } from 'react';
import type { Branding, Tournament } from '../types';

/** Readable text colour (near-black or white) on top of a hex background. */
function textOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#0a1610' : '#ffffff';
}

/** CSS variables that re-tint the app with the organiser's colour. */
export function brandStyle(b: Branding | undefined): CSSProperties | undefined {
  if (!b?.accent || !/^#[0-9a-f]{6}$/i.test(b.accent)) return undefined;
  return {
    '--accent': b.accent,
    '--accent-strong': `color-mix(in srgb, ${b.accent} 80%, var(--text))`,
    '--accent-soft': `color-mix(in srgb, ${b.accent} 16%, var(--surface))`,
    '--accent-text': textOn(b.accent),
  } as CSSProperties;
}

export function BrandLogo({ t, size = 56 }: { t: Tournament; size?: number }) {
  if (!t.branding?.logo) return <span className="t-emoji big">{t.emoji}</span>;
  return <img className="brand-logo" src={t.branding.logo} alt="" width={size} height={size} />;
}

export function SponsorStrip({ t, compact }: { t: Tournament; compact?: boolean }) {
  const sponsors = t.branding?.sponsors ?? [];
  if (!sponsors.length) return null;
  return (
    <section className={`sponsors ${compact ? 'compact' : ''}`} aria-label="Sponsors">
      <span className="sponsors-label">Supported by</span>
      <div className="sponsors-list">
        {sponsors.map((s, i) => {
          const body = s.logo ? <img src={s.logo} alt={s.name} title={s.name} /> : <span>{s.name}</span>;
          return s.url && !compact
            ? <a key={i} href={s.url} target="_blank" rel="noopener noreferrer sponsored" className="sponsor">{body}</a>
            : <span key={i} className="sponsor">{body}</span>;
        })}
      </div>
    </section>
  );
}

/** Shown on free tournaments' public pages; spectators are the best place to find new organisers. */
export function MadeWith({ t }: { t: Tournament }) {
  if (t.pro) return null;
  const home = `${window.location.origin}${window.location.pathname}#/`;
  return (
    <footer className="made-with">
      Made with <a href={home}>🏆 Matchcraft</a> · <a href={`${home.replace(/#\/$/, '')}#/new`}>Run your own tournament, free</a>
    </footer>
  );
}

/** Shrinks an uploaded image to fit `max` px and returns it as a PNG/JPEG data URL. */
export async function imageToDataUrl(file: File, max = 256): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Use a PNG, JPEG, WebP or GIF image.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That image could not be read.'));
      el.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL('image/png');
    if (data.length > 190_000) data = canvas.toDataURL('image/jpeg', 0.85);
    if (data.length > 190_000) throw new Error('That image is too detailed. Try a simpler logo.');
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}
