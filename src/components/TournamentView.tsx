import { useEffect, useState } from 'react';
import type { Change } from '../store';
import type { Match, Result, Tournament } from '../types';
import { navigate, useStore } from '../store';
import { api } from '../api';
import { FORMAT_INFO } from '../sports';
import { champion, groupLetter, groupMatches, groupParticipants, isByeMatch, progress, recompute } from '../engine/progress';
import { canAdvanceSwiss, nextSwissRound, swissRoundCount } from '../engine/swiss';
import { formatMinutes } from '../engine/result';
import { MatchCard } from './MatchCard';
import { StandingsTable } from './StandingsTable';
import { Bracket } from './Bracket';
import { Settings } from './Settings';
import { SharePanel } from './SharePanel';

type Tab = 'matches' | 'standings' | 'bracket' | 'settings';
type Filter = 'all' | 'upcoming' | 'played';

function tabsFor(t: Tournament, readOnly: boolean): Tab[] {
  const tabs: Tab[] = (() => {
    switch (t.format.kind) {
      case 'single': return ['matches'];
      case 'league':
      case 'swiss': return ['matches', 'standings'];
      case 'knockout': return ['bracket', 'matches'];
      case 'groups': return ['matches', 'standings', 'bracket'];
    }
  })();
  return readOnly ? tabs : [...tabs, 'settings'];
}

/** Every league, group or Swiss match has a score (and, for Swiss, every round has been paired). */
function tableDone(t: Tournament): boolean {
  if (t.format.kind !== 'league' && t.format.kind !== 'groups' && t.format.kind !== 'swiss') return false;
  if (t.format.kind === 'swiss' && swissRoundCount(t) < t.format.swissRounds) return false;
  const table = t.matches.filter((m) => m.stage !== 'knockout' && !isByeMatch(m) && !m.bye);
  return table.length > 0 && table.every((m) => m.result);
}

function allDone(t: Tournament): boolean {
  const { done, total } = progress(t);
  return total > 0 && done === total;
}

/** Where to send the organiser when a save completes a stage, with a short note why. */
function tabAfterSave(before: Tournament, after: Tournament): { tab: Tab; note: string } | null {
  if (!tableDone(before) && tableDone(after)) {
    const note = after.format.kind === 'groups'
      ? 'All group matches are in. Here are the final group tables; the knockout bracket is now set.'
      : 'All matches are in. Here are the final standings.';
    return { tab: 'standings', note };
  }
  if ((after.format.kind === 'knockout' || after.format.kind === 'groups') && !allDone(before) && allDone(after)) {
    return { tab: 'bracket', note: 'That was the last match. Here is the finished bracket.' };
  }
  return null;
}

const TAB_LABEL: Record<Tab, string> = { matches: 'Matches', standings: 'Standings', bracket: 'Bracket', settings: 'Settings' };

/** A tournament the signed-in user owns and can edit. */
export function TournamentPage({ id }: { id: string }) {
  const { get, update, refresh, loaded } = useStore();
  const t = get(id);

  // Pick up co-organisers' changes while the page is open.
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && void refresh(id);
    const timer = window.setInterval(tick, 15_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [id, refresh]);

  if (!t) {
    if (!loaded) return <div className="loading" aria-label="Loading" />;
    return (
      <div className="empty card">
        <p>Tournament not found.</p>
        <a className="btn" href="#/">Back home</a>
      </div>
    );
  }
  return <TournamentScreen t={t} onUpdate={(change) => update(id, change)} />;
}

/** Read-only view for anyone with a share link. */
export function PublicView({ shareId }: { shareId: string }) {
  const [state, setState] = useState<{ t?: Tournament; owner?: string; error?: string }>({});

  useEffect(() => {
    let active = true;
    const load = () =>
      api.publicView(shareId)
        .then(({ tournament, owner }) => active && setState({ t: recompute(tournament), owner }))
        .catch((e: Error) => active && setState({ error: e.message }));
    load();
    // Keep spectators up to date while the organiser enters scores.
    const timer = window.setInterval(load, 20_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [shareId]);

  if (state.error) {
    return (
      <div className="empty card">
        <p>{state.error}</p>
        <a className="btn" href="#/">Go to Matchcraft</a>
      </div>
    );
  }
  if (!state.t) return <div className="loading" aria-label="Loading" />;
  return <TournamentScreen t={state.t} subtitle={`Organised by ${state.owner} · updates live`} />;
}

function TournamentScreen({ t, onUpdate, subtitle }: { t: Tournament; onUpdate?: (change: Change) => Promise<boolean>; subtitle?: string }) {
  const readOnly = !onUpdate;
  const [tab, setTab] = useState<Tab | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const tabs = tabsFor(t, readOnly);
  const active = tab && tabs.includes(tab) ? tab : tabs[0];
  const setResult = onUpdate && ((matchId: string, result: Result | undefined) => {
    const apply = (cur: Tournament): Tournament => ({ ...cur, matches: cur.matches.map((m) => (m.id === matchId ? { ...m, result } : m)) });
    const jump = result && tabAfterSave(t, recompute(apply(t)));
    void onUpdate(apply).then((ok) => {
      if (!ok || !jump) return;
      setTab(jump.tab);
      setPicked(null);
      setNote(jump.note);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
  // Guarded so a round another organiser already paired isn't paired twice.
  const nextRound = onUpdate && (() => void onUpdate((cur) => (
    canAdvanceSwiss(cur) ? { ...cur, matches: [...cur.matches, ...nextSwissRound(cur)] } : cur
  )));

  const champ = champion(t);
  const champName = champ && t.participants.find((p) => p.id === champ)?.name;
  const { done, total } = progress(t);
  const pickedMatch = picked ? t.matches.find((m) => m.id === picked) : undefined;

  return (
    <div className="stack-lg">
      <section className="t-header">
        <div className="t-header-main">
          <span className="t-emoji big">{t.emoji}</span>
          <div>
            <h1>{t.name}</h1>
            <p className="muted">
              {t.sportName} · {FORMAT_INFO[t.format.kind].name} · {t.participants.length} {t.participantNoun.toLowerCase()}s · {done}/{total} played
              {t.rules.matchMinutes ? ` · ${formatMinutes(t.rules.matchMinutes)} matches` : ''}
            </p>
            {subtitle && <p className="muted small">{subtitle}</p>}
          </div>
        </div>
        <div className="row wrap">
          {champName && (
            <div className="champion">
              <span className="champion-cup">🏆</span>
              <div>
                <div className="small muted">Champion</div>
                <strong>{champName}</strong>
              </div>
            </div>
          )}
          {!readOnly && <SharePanel t={t} />}
        </div>
      </section>

      {tabs.length > 1 && (
        <nav className="tabs" role="tablist">
          {tabs.map((x) => (
            <button key={x} role="tab" aria-selected={active === x} className={active === x ? 'active' : ''} onClick={() => { setTab(x); setNote(''); }}>
              {TAB_LABEL[x]}
            </button>
          ))}
        </nav>
      )}

      {note && (
        <div className="notice" role="status">
          <span>🎉 {note}</span>
          <button className="icon-btn" onClick={() => setNote('')} aria-label="Dismiss">✕</button>
        </div>
      )}

      {active === 'matches' && (t.format.kind === 'single' ? (
        <div className="single-match">
          <MatchCard
            t={t} m={t.matches[0]} key={t.matches[0].result ? 'done' : 'open'}
            defaultOpen={!readOnly && !t.matches[0].result}
            onSave={setResult && ((r) => setResult(t.matches[0].id, r))}
          />
        </div>
      ) : (
        <MatchesTab
          t={t} filter={filter} setFilter={setFilter} onSave={setResult}
          onNextRound={nextRound}
        />
      ))}
      {active === 'standings' && <StandingsTab t={t} />}
      {active === 'bracket' && (
        <div className="stack">
          {pickedMatch && setResult && (
            <div className="picked">
              <MatchCard
                key={pickedMatch.id} t={t} m={pickedMatch} showStage defaultOpen
                onSave={(r) => { setResult(pickedMatch.id, r); setPicked(null); }}
              />
              <button className="btn btn-sm btn-ghost" onClick={() => setPicked(null)}>Close</button>
            </div>
          )}
          {t.format.kind === 'groups' && !t.matches.some((m) => m.stage === 'knockout' && m.home && m.away) && (
            <p className="muted">The bracket fills in as each group finishes.</p>
          )}
          <Bracket t={t} onPick={setResult && ((m: Match) => setPicked(m.id))} />
        </div>
      )}
      {active === 'settings' && onUpdate && (
        <Settings t={t} onUpdate={onUpdate} onLeave={() => navigate('/')} />
      )}
    </div>
  );
}

function sectionKey(m: Match): string {
  if (m.stage === 'knockout') return `ko-${m.round}`;
  return `${m.stage}-${m.round}`;
}

function sectionTitle(m: Match): string {
  if (m.stage === 'knockout') return m.roundName ?? `Round ${m.round}`;
  if (m.stage === 'group') return `Group stage · Matchday ${m.round}`;
  return `Round ${m.round}`;
}

function MatchesTab({ t, filter, setFilter, onSave, onNextRound }: {
  t: Tournament; filter: Filter; setFilter: (f: Filter) => void;
  onSave?: (id: string, r: Result | undefined) => void; onNextRound?: () => void;
}) {
  const visible = t.matches.filter((m) => !isByeMatch(m)).filter((m) =>
    filter === 'all' ? true : filter === 'played' ? m.result : !m.result,
  );

  const sections: { key: string; title: string; matches: Match[] }[] = [];
  for (const m of visible) {
    const key = sectionKey(m);
    let s = sections.find((x) => x.key === key);
    if (!s) {
      s = { key, title: sectionTitle(m), matches: [] };
      sections.push(s);
    }
    s.matches.push(m);
  }

  const swiss = t.format.kind === 'swiss';
  const roundsPlayed = swiss ? swissRoundCount(t) : 0;

  return (
    <div className="stack">
      <div className="row wrap between">
        <div className="segmented small-seg">
          {(['all', 'upcoming', 'played'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {onSave && <span className="muted small">Tap a match to enter the score.</span>}
      </div>

      {sections.length === 0 && <p className="muted">Nothing here.</p>}
      {sections.map((s) => (
        <section key={s.key} className="stack-sm">
          <h3 className="section-title">{s.title}</h3>
          <div className="match-list">
            {s.matches.map((m) => (
              <MatchCard key={m.id} t={t} m={m} showStage={m.stage === 'group'} onSave={onSave && ((r) => onSave(m.id, r))} />
            ))}
          </div>
        </section>
      ))}

      {swiss && (
        <div className="card row between wrap">
          <span>
            Round {roundsPlayed} of {t.format.swissRounds}
            {onNextRound && roundsPlayed < t.format.swissRounds && !canAdvanceSwiss(t) && (
              <span className="muted"> · finish this round to pair the next</span>
            )}
          </span>
          {onNextRound && roundsPlayed < t.format.swissRounds && (
            <button className="btn btn-primary" disabled={!canAdvanceSwiss(t)} onClick={onNextRound}>
              Pair round {roundsPlayed + 1}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function StandingsTab({ t }: { t: Tournament }) {
  if (t.format.kind === 'groups' && t.groups) {
    return (
      <div className="groups-grid">
        {t.groups.map((_, g) => (
          <StandingsTable
            key={g} title={`Group ${groupLetter(g)}`} rules={t.rules}
            participants={groupParticipants(t, g)} matches={groupMatches(t, g)} qualify={t.format.advancePerGroup}
          />
        ))}
      </div>
    );
  }
  return <StandingsTable participants={t.participants} matches={t.matches} rules={t.rules} qualify={1} />;
}
