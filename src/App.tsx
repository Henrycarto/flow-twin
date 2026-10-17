import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BASELINE, DAY, DAYS, START_OCCUPIED, WARD_BEDS, bestMoves, busiestMinute, metrics, simulate, type Levers, type Metrics } from './sim/flow';
import { Chart } from './ui/Chart';
import { Twin } from './ui/Twin';

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const hm = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`;

function Stat({ label, now, was, fmt, better }: { label: string; now: number; was: number; fmt: (v: number) => string; better: 'up' | 'down' }) {
  const d = now - was;
  const same = Math.abs(d) < 1e-9;
  const good = better === 'up' ? d > 0 : d < 0;
  return (
    <div className={`stat${same ? '' : good ? ' good' : ' bad'}`}>
      <span className="s-l">{label}</span>
      <b className="s-v">{fmt(now)}</b>
      <span className="s-d">{same ? 'same as baseline' : `baseline ${fmt(was)}`}</span>
    </div>
  );
}

export default function App() {
  const [dayId, setDayId] = useState('mon');
  const [levers, setLevers] = useState<Levers>(BASELINE);
  const [m, setM] = useState(() => busiestMinute(simulate(BASELINE, DAYS[0].seed)));
  const [playing, setPlaying] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);
  const raf = useRef<number | null>(null);
  const last = useRef(0);

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
  }, [theme]);
  const dimmed = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;

  const d = DAYS.find((x) => x.id === dayId)!;
  const base = useMemo(() => simulate(BASELINE, d.seed), [d.seed]);
  const scen = useMemo(() => simulate(levers, d.seed), [levers, d.seed]);
  const mb: Metrics = useMemo(() => metrics(base), [base]);
  const ms: Metrics = useMemo(() => metrics(scen), [scen]);
  const moves = useMemo(() => bestMoves(levers, d.seed), [levers, d.seed]);

  const stop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    setPlaying(false);
  }, []);
  const play = () => {
    if (playing) return stop();
    if (m >= DAY - 1) setM(0);
    setPlaying(true);
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      let done = false;
      setM((cur) => {
        const next = Math.min(DAY - 1, cur + dt * 24); // the day in a minute
        if (next >= DAY - 1) done = true;
        return next;
      });
      if (done) return stop();
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => stop, [stop]);

  const c = scen.census[Math.min(DAY - 1, Math.floor(m))];
  const set = (patch: Partial<Levers>) => setLevers((l) => ({ ...l, ...patch }));
  const changed = JSON.stringify(levers) !== JSON.stringify(BASELINE);

  return (
    <div className="shell">
      <header className="banner">
        <div className="who">
          <h1>Hospital flow twin</h1>
          <span>One day from the front door to a ward bed and home. {WARD_BEDS} medical beds, {START_OCCUPIED} full at midnight.</span>
        </div>
        <div className="spacer" />
        <div className="days" role="radiogroup" aria-label="Day">
          {DAYS.map((x) => (
            <button key={x.id} role="radio" aria-checked={x.id === dayId} className={x.id === dayId ? 'on' : ''} onClick={() => { stop(); setDayId(x.id); setLevers(BASELINE); setM(busiestMinute(simulate(BASELINE, x.seed))); }}>
              <b>{x.label}</b>
              <small>{x.note}</small>
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => setTheme(dimmed ? 'light' : 'dark')} aria-pressed={dimmed}>{dimmed ? 'Bright display' : 'Dim display'}</button>
      </header>

      <main className="main">
        <section className="stage">
          <div className="transport">
            <button className="btn primary" onClick={play}>{playing ? 'Pause' : m >= DAY - 1 ? 'Play the day in a minute' : m > 0 ? 'Play from here' : 'Play the day in a minute'}</button>
            <input type="range" min={0} max={DAY - 1} value={Math.floor(m)} onChange={(e) => { stop(); setM(Number(e.target.value)); }} aria-label="Time of day" className="scrub" />
            <div className="live">
              <span><b>{c.waiting}</b> waiting</span>
              <span><b>{c.seen}</b> with a doctor</span>
              <span className={c.boarding ? 'warn' : ''}><b>{c.boarding}</b> waiting for a bed</span>
              <span><b>{c.wardFree}</b> beds free</span>
            </div>
          </div>
          <Twin r={scen} m={Math.floor(m)} doctors={levers.doctors} />
          <div className="key">
            <span><i className="k-ok" /> In the ED under 2 h</span>
            <span><i className="k-long" /> 2 to 4 h</span>
            <span><i className="k-late" /> Over 4 h</span>
            <span><i className="k-home" /> Going home</span>
            <span><i className="k-bed" /> Occupied bed</span>
            <span><i className="k-new" /> Admitted in the last hour</span>
            <span><i className="k-clean" /> Being cleaned</span>
            <span><i className="k-free" /> Free</span>
          </div>
          <Chart base={base} scen={scen} m={Math.floor(m)} onScrub={(t) => { stop(); setM(t); }} />
        </section>

        <aside className="panel">
          <section className="card levers">
            <div className="card-head">
              <span className="kicker">Levers</span>
              {changed && <button className="link" onClick={() => setLevers(BASELINE)}>Back to baseline</button>}
            </div>
            <div className="lever">
              <span>ED doctors</span>
              <div className="stepper">
                <button onClick={() => set({ doctors: Math.max(2, levers.doctors - 1) })} aria-label="One fewer doctor">−</button>
                <b>{levers.doctors}</b>
                <button onClick={() => set({ doctors: Math.min(7, levers.doctors + 1) })} aria-label="One more doctor">+</button>
              </div>
            </div>
            <div className="lever">
              <span>Escalation beds</span>
              <div className="stepper">
                <button onClick={() => set({ escalationBeds: Math.max(0, levers.escalationBeds - 1) })} aria-label="One fewer bed">−</button>
                <b>{levers.escalationBeds}</b>
                <button onClick={() => set({ escalationBeds: Math.min(6, levers.escalationBeds + 1) })} aria-label="One more bed">+</button>
              </div>
            </div>
            {([['dischargeBeforeNoon', 'Discharge before noon'], ['dischargeLounge', 'Discharge lounge']] as const).map(([k, label]) => (
              <div className="lever" key={k}>
                <span id={`l-${k}`}>{label}</span>
                <button role="switch" aria-checked={levers[k]} aria-labelledby={`l-${k}`} className="switch" onClick={() => set({ [k]: !levers[k] })}><span /></button>
              </div>
            ))}
          </section>

          <section className="card">
            <span className="kicker">{d.label}, against the same day with baseline levers</span>
            <div className="stats">
              <Stat label="Left the ED within 4 hours" now={ms.within4h} was={mb.within4h} fmt={pct} better="up" />
              <Stat label="Hours waiting for a bed" now={ms.boardingHours} was={mb.boardingHours} fmt={(v) => v.toFixed(1)} better="down" />
              <Stat label="Average wait to see a doctor" now={ms.waitingForDoctor} was={mb.waitingForDoctor} fmt={(v) => `${Math.round(v)} min`} better="down" />
              <Stat label="Longest time in the ED" now={ms.longestWait} was={mb.longestWait} fmt={hm} better="down" />
            </div>
            <p className="note">{ms.attendances} attendances, {ms.admissions} needing a bed. {ms.stillWaitingForBed ? `${ms.stillWaitingForBed} still waiting for a bed at midnight.` : 'Nobody waiting for a bed at midnight.'}</p>
          </section>

          <section className="card">
            <span className="kicker">Best single move from here</span>
            <ol className="moves">
              {moves.map((x) => (
                <li key={x.id}>
                  <button onClick={() => setLevers(x.levers)}>
                    <span className="mv">{x.label}</span>
                    <span className={`dv${x.within4h > 0.05 ? ' good' : x.within4h < -0.05 ? ' bad' : ''}`}>{x.within4h >= 0 ? '+' : ''}{x.within4h.toFixed(1)} points</span>
                    <span className={`db${x.boardingHours < -0.05 ? ' good' : x.boardingHours > 0.05 ? ' bad' : ''}`}>{x.boardingHours >= 0 ? '+' : ''}{x.boardingHours.toFixed(1)} h waiting for a bed</span>
                  </button>
                </li>
              ))}
            </ol>
            <p className="note">Each move is run on the same day, the same patients, from the levers you have now.</p>
          </section>
          <p className="foot">A simulated hospital with simple, written-down assumptions, for demonstrating interface design and flow logic. Not a planning tool.</p>
        </aside>
      </main>
    </div>
  );
}
