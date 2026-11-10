import { useEffect, useMemo, useState } from 'react';
import type { Match, Tournament } from '../types';
import { champion, groupLetter, groupMatches, groupParticipants, isByeMatch } from '../engine/progress';
import { formatClock, spansDays, upNext } from '../engine/schedule';
import { FORMAT_INFO } from '../sports';
import { usePublicTournament } from './TournamentView';
import { StandingsTable } from './StandingsTable';
import { Bracket } from './Bracket';
import { BrandLogo, SponsorStrip, brandStyle } from './Brand';
import { shareUrl } from './SetupScreen';

const ROTATE_MS = 15_000;

type Panel = { key: string; title: string; render: () => JSX.Element };

const nameOf = (t: Tournament, id: string | null) => (id && t.participants.find((p) => p.id === id)?.name) || 'TBD';

function MatchLine({ t, m, withDay }: { t: Tournament; m: Match; withDay: boolean }) {
  const r = m.result;
  return (
    <div className="tv-match">
      <span className="tv-when">{m.startsAt !== undefined ? formatClock(m.startsAt, withDay) : ''}</span>
      <span className={`tv-team home ${r?.winner === 'home' ? 'win' : ''}`}>{nameOf(t, m.home)}</span>
      <span className="tv-score">{r ? `${r.home} – ${r.away}` : 'vs'}</span>
      <span className={`tv-team away ${r?.winner === 'away' ? 'win' : ''}`}>{nameOf(t, m.away)}</span>
      <span className="tv-where">{m.court ?? ''}</span>
    </div>
  );
}

/** Which screens to cycle through, depending on format and progress. */
function panelsFor(t: Tournament, shareId: string): Panel[] {
  const withDay = spansDays(t);
  if (t.phase === 'setup') {
    return [{
      key: 'signups', title: 'Sign-ups',
      render: () => (
        <div className="tv-signups">
          <p className="tv-big">{t.registration?.open ? 'Sign up now at' : 'Sign-ups are closed'}</p>
          {t.registration?.open && <p className="tv-url">{shareUrl(shareId).replace(/^https?:\/\//, '')}</p>}
          <ol className="tv-entries">{[...t.participants].sort((a, b) => a.seed - b.seed).map((p) => <li key={p.id}>{p.name}</li>)}</ol>
        </div>
      ),
    }];
  }

  const panels: Panel[] = [];
  const real = t.matches.filter((m) => !isByeMatch(m) && !m.bye);
  const next = upNext(t, 6);
  const pending = next.length ? next : real.filter((m) => !m.result && m.home && m.away).slice(0, 6);
  if (pending.length) {
    panels.push({ key: 'next', title: 'Up next', render: () => <div className="tv-list">{pending.map((m) => <MatchLine key={m.id} t={t} m={m} withDay={withDay} />)}</div> });
  }
  const played = real.filter((m) => m.result);
  if (played.length) {
    const latest = [...played].sort((a, b) => (b.startsAt ?? 0) - (a.startsAt ?? 0)).slice(0, 6);
    panels.push({ key: 'results', title: 'Latest results', render: () => <div className="tv-list">{latest.map((m) => <MatchLine key={m.id} t={t} m={m} withDay={withDay} />)}</div> });
  }
  if (t.format.kind === 'groups' && t.groups) {
    // Large events: show at most four groups per screen.
    for (let start = 0; start < t.groups.length; start += 4) {
      const gs = t.groups.slice(start, start + 4).map((_, i) => start + i);
      panels.push({
        key: `groups-${start}`, title: t.groups.length > 4 ? `Groups ${groupLetter(gs[0])}–${groupLetter(gs[gs.length - 1])}` : 'Groups',
        render: () => (
          <div className="tv-groups">
            {gs.map((g) => (
              <StandingsTable key={g} title={`Group ${groupLetter(g)}`} rules={t.rules} participants={groupParticipants(t, g)} matches={groupMatches(t, g)} qualify={t.format.advancePerGroup} />
            ))}
          </div>
        ),
      });
    }
  }
  if (t.format.kind === 'league' || t.format.kind === 'swiss') {
    panels.push({ key: 'table', title: 'Standings', render: () => <StandingsTable participants={t.participants} matches={t.matches} rules={t.rules} qualify={1} /> });
  }
  if (t.format.kind === 'knockout' || (t.format.kind === 'groups' && t.matches.some((m) => m.stage === 'knockout' && m.home))) {
    panels.push({ key: 'bracket', title: 'Bracket', render: () => <Bracket t={t} /> });
  }
  return panels;
}

/** #/tv/<shareId>: a full-screen, hands-off display for a venue screen or projector. */
export function TvView({ shareId }: { shareId: string }) {
  const { t, error } = usePublicTournament(shareId);
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(Date.now());
  const panels = useMemo(() => (t ? panelsFor(t, shareId) : []), [t, shareId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((i) => i + 1);
      setNow(Date.now());
    }, ROTATE_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(clock);
    };
  }, []);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  if (error) return <div className="tv tv-message"><p>{error}</p></div>;
  if (!t) return <div className="tv"><div className="loading" aria-label="Loading" /></div>;

  const panel = panels.length ? panels[index % panels.length] : null;
  const champ = champion(t);

  return (
    <div className="tv" style={brandStyle(t.branding)} onDoubleClick={fullscreen}>
      <header className="tv-head">
        <BrandLogo t={t} size={72} />
        <div className="tv-title">
          <h1>{t.name}</h1>
          <span>{t.sportName} · {FORMAT_INFO[t.format.kind].name}</span>
        </div>
        <div className="tv-clock">{formatClock(now)}</div>
      </header>

      <main className="tv-body">
        {champ ? (
          <div className="tv-champion">
            <span className="tv-cup">🏆</span>
            <p>Champion</p>
            <h2>{nameOf(t, champ)}</h2>
          </div>
        ) : panel ? (
          <section key={`${panel.key}-${index}`} className="tv-panel">
            <h2 className="tv-panel-title">{panel.title}</h2>
            {panel.render()}
          </section>
        ) : (
          <p className="tv-big">Fixtures coming soon</p>
        )}
      </main>

      <footer className="tv-foot">
        {panels.length > 1 && !champ && (
          <div className="tv-dots" aria-hidden>
            {panels.map((p, i) => <span key={p.key} className={i === index % panels.length ? 'on' : ''} />)}
          </div>
        )}
        <SponsorStrip t={t} compact />
        {!t.pro && <span className="tv-made">Made with 🏆 Matchcraft</span>}
        <button className="tv-fs" onClick={fullscreen} aria-label="Toggle full screen">⛶</button>
      </footer>
    </div>
  );
}
