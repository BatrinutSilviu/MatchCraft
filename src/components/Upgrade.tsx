import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';

const PRO_FEATURES = [
  'More entries than the free limit',
  'Your logo and colours on the public page and TV screen',
  'Sponsor logos, linked to their sites',
  'No Matchcraft footer for spectators',
];

async function goToCheckout(kind: 'event' | 'club', tournamentId: string | undefined, onError: (m: string) => void) {
  try {
    const { url } = await api.checkout(kind, tournamentId);
    window.location.assign(url);
  } catch (e) {
    onError(e instanceof Error ? e.message : 'Something went wrong.');
  }
}

/** Opened whenever a change needs a paid plan, from anywhere in the app. */
export function UpgradeDialog() {
  const { upgrade, askUpgrade, billing, auth } = useStore();
  const [busy, setBusy] = useState<'' | 'event' | 'club'>('');
  const [error, setError] = useState('');
  if (!upgrade || !billing.enabled) return null;
  const isClub = auth.status === 'in' && auth.user.plan === 'club';

  const buy = (kind: 'event' | 'club') => {
    setBusy(kind);
    setError('');
    void goToCheckout(kind, upgrade.tournamentId, (m) => { setError(m); setBusy(''); });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && askUpgrade(null)}>
      <div className="modal card stack" role="dialog" aria-modal="true" aria-labelledby="upgrade-title">
        <div className="row between">
          <h2 id="upgrade-title">Unlock Pro</h2>
          <button className="icon-btn" onClick={() => askUpgrade(null)} aria-label="Close">✕</button>
        </div>
        <p>{upgrade.reason}</p>
        <ul className="ticks">{PRO_FEATURES.map((f) => <li key={f}>{f}</li>)}</ul>
        {billing.provider === 'fake' && <p className="pill">Test mode: no real payment is taken.</p>}
        {error && <p className="error small">{error}</p>}
        <div className="plan-options">
          {upgrade.tournamentId && (
            <button className="plan-option" disabled={Boolean(busy)} onClick={() => buy('event')}>
              <strong>Event pass · {billing.prices.event}</strong>
              <span className="muted small">One-off. Pro for this tournament, forever.</span>
            </button>
          )}
          {!isClub && (
            <button className="plan-option featured" disabled={Boolean(busy)} onClick={() => buy('club')}>
              <strong>Club · {billing.prices.club}</strong>
              <span className="muted small">Every tournament you run is Pro. Cancel any time.</span>
            </button>
          )}
        </div>
        {busy && <p className="muted small">Opening secure checkout…</p>}
      </div>
    </div>
  );
}

/** Settings card for one tournament's plan. */
export function PlanCard({ tournamentId, pro }: { tournamentId: string; pro?: boolean }) {
  const { billing, askUpgrade, auth } = useStore();
  if (!billing.enabled) return null;
  const club = auth.status === 'in' && auth.user.plan === 'club';
  return (
    <section className="card row wrap between">
      <div>
        <h3>{pro ? '✨ Pro' : 'Free plan'}</h3>
        <p className="muted small">
          {pro
            ? club ? 'Covered by your Club plan.' : 'All Pro features are unlocked for this tournament.'
            : `Up to ${billing.freeParticipantLimit} entries, Matchcraft footer on the public page, no branding.`}
        </p>
      </div>
      {!pro && (
        <button className="btn btn-primary" onClick={() => askUpgrade({ tournamentId, reason: 'Make this tournament yours.' })}>
          Upgrade
        </button>
      )}
    </section>
  );
}

/** #/account: the user's plan and billing. */
export function AccountPlanPage({ upgraded }: { upgraded: boolean }) {
  const { auth, billing, refreshUser, showError } = useStore();
  const [busy, setBusy] = useState(false);
  if (auth.status !== 'in') return null;
  const club = auth.user.plan === 'club';

  const manage = async () => {
    setBusy(true);
    try {
      window.location.assign((await api.billingPortal()).url);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  return (
    <div className="stack-lg narrow">
      <h1>Plan & billing</h1>
      {upgraded && (
        <div className="notice" role="status">
          <span>🎉 Thanks! Your upgrade is being applied; it can take a few seconds.</span>
          <button className="btn btn-sm" onClick={() => void refreshUser()}>Refresh</button>
        </div>
      )}
      {!billing.enabled ? (
        <div className="card"><p>Every feature is included on this server.</p></div>
      ) : (
        <>
          <section className="card stack">
            <h3>{club ? '✨ Club' : 'Free'}</h3>
            <p className="muted">
              {club
                ? 'Every tournament you own has Pro features.'
                : `Run as many tournaments as you like with up to ${billing.freeParticipantLimit} entries each. Upgrade one event with a pass, or all of them with Club.`}
            </p>
            <div className="row wrap">
              {club ? (
                billing.provider === 'stripe' && (
                  <button className="btn" disabled={busy} onClick={manage}>Manage subscription</button>
                )
              ) : (
                <button className="btn btn-primary" disabled={busy} onClick={() => {
                  setBusy(true);
                  void goToCheckout('club', undefined, (m) => { showError(m); setBusy(false); });
                }}>
                  Get Club · {billing.prices.club}
                </button>
              )}
            </div>
          </section>
          <section className="card stack-sm">
            <h3>What Pro adds</h3>
            <ul className="ticks">{PRO_FEATURES.map((f) => <li key={f}>{f}</li>)}</ul>
            <p className="muted small">Event passes ({billing.prices.event}) are bought from a tournament’s Settings tab.</p>
          </section>
        </>
      )}
    </div>
  );
}
