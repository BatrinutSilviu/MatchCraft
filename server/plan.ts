import type { Ctx } from './http';

/** True when the tournament's paid features are unlocked. */
export function isPro(ctx: Ctx, row: { plan: string; owner_plan: string }): boolean {
  return !ctx.billing || row.plan === 'pro' || row.owner_plan === 'club';
}

export const UPGRADE = 'upgrade';

const DATA_IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE = 200_000;

/** Returns an error message when branding holds anything unsafe or oversized, else null. */
export function brandingError(b: unknown): string | null {
  if (b === undefined || b === null) return null;
  if (typeof b !== 'object') return 'Invalid branding.';
  const { accent, logo, sponsors } = b as Record<string, unknown>;
  if (accent !== undefined && (typeof accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(accent))) return 'Pick a valid colour.';
  const image = (v: unknown) => v === undefined || (typeof v === 'string' && v.length <= MAX_IMAGE && DATA_IMAGE.test(v));
  if (!image(logo)) return 'Logos must be PNG, JPEG, WebP or GIF images under 150 KB.';
  if (sponsors !== undefined) {
    if (!Array.isArray(sponsors) || sponsors.length > 12) return 'Add at most 12 sponsors.';
    for (const sp of sponsors) {
      if (!sp || typeof sp !== 'object') return 'Invalid sponsor.';
      const { name, url, logo: spLogo } = sp as Record<string, unknown>;
      if (typeof name !== 'string' || !name.trim() || name.length > 80) return 'Each sponsor needs a name.';
      if (!image(spLogo)) return 'Sponsor logos must be PNG, JPEG, WebP or GIF images under 150 KB.';
      if (url !== undefined && (typeof url !== 'string' || url.length > 500 || !/^https?:\/\/[^\s]+$/i.test(url))) {
        return 'Sponsor links must start with http:// or https://.';
      }
    }
  }
  return null;
}

/** Branding counts as "used" when any of it is set. */
export function hasBranding(b: unknown): boolean {
  if (!b || typeof b !== 'object') return false;
  const { accent, logo, sponsors } = b as Record<string, unknown>;
  return Boolean(accent || logo || (Array.isArray(sponsors) && sponsors.length));
}
