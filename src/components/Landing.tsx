import { SPORTS } from '../sports';

const STEPS = [
  { icon: '🏅', title: 'Pick your sport', text: `Start from ${SPORTS.length - 1} sports or invent your own. Rules come pre-filled.` },
  { icon: '🗂️', title: 'Choose a format', text: 'League, knockout, groups + knockout, Swiss, or a single match.' },
  { icon: '📲', title: 'Enter scores, share the link', text: 'Tables and brackets update instantly. Anyone with the link can follow along.' },
];

export function Landing() {
  return (
    <div className="stack-lg">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Tournaments made easy</span>
          <h1>Build any tournament, <span className="hl">for any sport.</span></h1>
          <p>
            Set it up in about a minute. Matchcraft handles the fixtures, standings and brackets, so you can
            focus on the games.
          </p>
          <div className="row wrap">
            <a href="#/signup" className="btn btn-primary btn-lg">Get started, it’s free</a>
            <a href="#/login" className="btn btn-glass btn-lg">Log in</a>
          </div>
        </div>
        <div className="hero-visual" aria-hidden>
          <div className="hv-card hv-live">
            <div className="hv-head"><span className="hv-dot" /> Live · Final</div>
            <div className="hv-line win"><span>🦶 Rapid Feet</span><b>2</b></div>
            <div className="hv-line"><span>🦶 Net Ninjas</span><b>1</b></div>
            <div className="hv-sets">11–8 · 9–11 · 11–6</div>
          </div>
          <div className="hv-card hv-table">
            <div className="hv-head">Group A</div>
            {[['Rapid Feet', 9], ['Net Ninjas', 6], ['Volley Boys', 3], ['Kick Club', 0]].map(([n, p], i) => (
              <div key={n} className={`hv-row ${i < 2 ? 'q' : ''}`}><span>{i + 1}</span><span>{n}</span><b>{p}</b></div>
            ))}
          </div>
        </div>
        <div className="sport-strip">
          {SPORTS.map((s) => <span key={s.id} title={s.name}>{s.emoji}</span>)}
        </div>
      </section>
      <section className="how">
        {STEPS.map((s, i) => (
          <div key={s.title} className="card how-step">
            <div className="row between">
              <span className="how-icon">{s.icon}</span>
              <span className="how-num">0{i + 1}</span>
            </div>
            <strong>{s.title}</strong>
            <p className="muted small">{s.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
