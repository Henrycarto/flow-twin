/** The isometric twin: ED waiting room, doctors' cubicles, the boarding corridor, the ward and the discharge lounge. */
import { useMemo } from 'react';
import { DAY, bedAt, edMinutes, whereAt, type Result } from '../sim/flow';

const S = 26;
const iso = (x: number, y: number): [number, number] => [(x - y) * 0.866 * S, (x + y) * 0.5 * S];
const poly = (x0: number, y0: number, x1: number, y1: number, lift = 0) =>
  [iso(x0, y0), iso(x1, y0), iso(x1, y1), iso(x0, y1)].map(([a, b]) => `${a.toFixed(1)},${(b - lift).toFixed(1)}`).join(' ');

interface Zone {
  id: string;
  label: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const ZONES: Zone[] = [
  { id: 'wait', label: 'ED waiting', x0: 0, y0: 0, x1: 6, y1: 5 },
  { id: 'cubicles', label: 'ED doctors', x0: 7, y0: 0, x1: 13.5, y1: 5 },
  { id: 'board', label: 'Waiting for a bed', x0: 14.5, y0: 0, x1: 19, y1: 5 },
  { id: 'ward', label: 'Medical ward', x0: 0, y0: 7, x1: 19, y1: 15 },
  { id: 'lounge', label: 'Discharge lounge', x0: 20, y0: 7, x1: 24, y1: 11 },
];
const zone = (id: string) => ZONES.find((z) => z.id === id)!;

/** The i-th person in a zone, on a loose grid. */
function slot(z: Zone, i: number): [number, number] {
  const cols = Math.max(1, Math.floor((z.x1 - z.x0 - 0.6) / 0.72));
  return [z.x0 + 0.5 + (i % cols) * 0.72, z.y0 + 0.6 + Math.floor(i / cols) * 0.72];
}

const tone = (minutes: number) => (minutes > 240 ? 'late' : minutes > 120 ? 'long' : 'ok');

export function Twin({ r, m, doctors }: { r: Result; m: number; doctors: number }) {
  const beds = r.beds;
  const bedPos = (b: number): [number, number] => {
    const col = b % 12;
    const row = Math.floor(b / 12);
    return [0.5 + col * 1.54, 7.6 + row * 1.85];
  };

  const people = useMemo(() => {
    const out: Array<{ id: string; x: number; y: number; cls: string; title: string }> = [];
    const counters = { waiting: 0, boarding: 0 };
    const cubicle: Array<number | null> = Array.from({ length: doctors }, () => null);
    const byDoctor: number[] = [];
    for (const p of r.patients) {
      const w = whereAt(p, m);
      if (!w || w === 'gone') continue;
      const mins = (p.left ?? m) - p.arrive;
      const t = `${Math.floor(edMinutes({ ...p, left: Math.min(p.left ?? m, m) }) / 60)} h ${edMinutes({ ...p, left: Math.min(p.left ?? m, m) }) % 60} min in the ED`;
      if (w === 'waiting') {
        const [x, y] = slot(zone('wait'), counters.waiting++);
        out.push({ id: `p${p.id}`, x, y, cls: tone(m - p.arrive), title: t });
      } else if (w === 'seen') {
        let k = cubicle.findIndex((c) => c === null);
        if (k < 0) k = 0;
        cubicle[k] = p.id;
        byDoctor.push(k);
        out.push({ id: `p${p.id}`, x: 7.5 + k * 0.88 + 0.3, y: 2.9, cls: tone(m - p.arrive), title: t });
      } else {
        const [x, y] = slot(zone('board'), counters.boarding++);
        out.push({ id: `p${p.id}`, x, y, cls: tone(mins), title: `${t}, waiting for a bed` });
      }
    }
    // patients waiting in the lounge for transport home, their bed already freed
    let li = 0;
    for (const d of r.discharges) {
      if (d.freed <= m && m < d.at) {
        const [x, y] = slot(zone('lounge'), li++);
        out.push({ id: `d${d.id}`, x, y, cls: 'home', title: 'Discharged, waiting for transport' });
      }
    }
    return out;
  }, [r, m, doctors]);

  const lounge = r.levers.dischargeLounge;
  const pts = [iso(-1.5, -1), iso(25, -1), iso(25, 16.5), iso(-1.5, 16.5)];
  const minX = Math.min(...pts.map((p) => p[0])) - 10;
  const maxX = Math.max(...pts.map((p) => p[0])) + 10;
  const minY = Math.min(...pts.map((p) => p[1])) - 40;
  const maxY = Math.max(...pts.map((p) => p[1])) + 10;

  return (
    <svg className="twin" viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} role="img" aria-label="Isometric view of the hospital at the selected minute">
      {/* floor */}
      <polygon points={poly(-1.5, -1, 25, 16.5)} className="floor" />
      {ZONES.map((z) => (
        <g key={z.id} className={`zone ${z.id}${z.id === 'lounge' && !lounge ? ' closed' : ''}`}>
          <polygon points={poly(z.x0, z.y0, z.x1, z.y1)} className="zfloor" />
          {/* back walls give the plan some depth */}
          <polygon points={`${iso(z.x0, z.y0)[0]},${iso(z.x0, z.y0)[1]} ${iso(z.x1, z.y0)[0]},${iso(z.x1, z.y0)[1]} ${iso(z.x1, z.y0)[0]},${iso(z.x1, z.y0)[1] - 14} ${iso(z.x0, z.y0)[0]},${iso(z.x0, z.y0)[1] - 14}`} className="wall" />
          <polygon points={`${iso(z.x0, z.y0)[0]},${iso(z.x0, z.y0)[1]} ${iso(z.x0, z.y1)[0]},${iso(z.x0, z.y1)[1]} ${iso(z.x0, z.y1)[0]},${iso(z.x0, z.y1)[1] - 14} ${iso(z.x0, z.y0)[0]},${iso(z.x0, z.y0)[1] - 14}`} className="wall side" />
          <text x={iso(z.x0, z.y0)[0] + 6} y={iso(z.x0, z.y0)[1] - 20} className="zlabel">{z.id === 'lounge' && !lounge ? 'Discharge lounge (closed)' : z.label}</text>
        </g>
      ))}

      {/* doors */}
      <g className="door">
        <polygon points={poly(-1.4, 1.8, -0.2, 3.2)} />
        <text x={iso(-1.4, 3.6)[0] - 8} y={iso(-1.4, 3.6)[1] + 14} textAnchor="end" className="zlabel small">Arrivals</text>
      </g>
      <g className="door">
        <polygon points={poly(24.1, 8.3, 25, 9.7)} />
        <text x={iso(25, 8.3)[0] + 6} y={iso(25, 8.3)[1] - 4} className="zlabel small">Home</text>
      </g>

      {/* cubicles */}
      {Array.from({ length: doctors }, (_, k) => {
        const x = 7.5 + k * 0.88;
        return (
          <g key={k} className="cubicle">
            <polygon points={poly(x, 1.2, x + 0.74, 4.2)} />
            <circle cx={iso(x + 0.37, 1.7)[0]} cy={iso(x + 0.37, 1.7)[1] - 9} r={4.2} className="doctor" />
            <rect x={iso(x + 0.37, 1.7)[0] - 3} y={iso(x + 0.37, 1.7)[1] - 5} width={6} height={7} rx={2} className="doctor" />
          </g>
        );
      })}

      {/* beds */}
      {Array.from({ length: beds }, (_, b) => {
        const [x, y] = bedPos(b);
        const st = bedAt(r, b, m);
        const extra = b >= beds - r.levers.escalationBeds;
        return (
          <g key={b} className={`bed ${st}${extra ? ' extra' : ''}`}>
            <polygon points={poly(x, y, x + 1.1, y + 1.4)} className="frame" />
            <polygon points={poly(x + 0.08, y + 0.08, x + 1.02, y + 1.32, 5)} className="top" />
            <polygon points={poly(x + 0.15, y + 0.12, x + 0.95, y + 0.42, 7)} className="pillow" />
            <title>{`Bed ${b + 1}${extra ? ' (escalation)' : ''}: ${st === 'new' ? 'admitted in the last hour' : st}`}</title>
          </g>
        );
      })}

      {/* people, animated between places */}
      {people.map((p) => {
        const [X, Y] = iso(p.x, p.y);
        return (
          <g key={p.id} className={`person ${p.cls}`} style={{ transform: `translate(${X}px, ${Y - 7}px)` }}>
            <ellipse cx={0} cy={7} rx={5} ry={2.4} className="shadow" />
            <circle r={5.2} />
            <title>{p.title}</title>
          </g>
        );
      })}

      <text x={minX + 8} y={maxY - 8} className="clock-big">{m >= DAY ? '24:00' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`}</text>
    </svg>
  );
}
