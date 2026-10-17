/** People in the ED across the day: the scenario against the baseline, with the playhead. */
import type { Result } from '../sim/flow';

export function Chart({ base, scen, m, onScrub }: { base: Result; scen: Result; m: number; onScrub: (m: number) => void }) {
  const W = 600;
  const H = 120;
  const total = (r: Result) => r.census.map((c) => c.waiting + c.seen + c.boarding);
  const board = (r: Result) => r.census.map((c) => c.boarding);
  const all = [...total(base), ...total(scen)];
  const max = Math.max(10, ...all);
  const x = (i: number) => (i / 1439) * W;
  const y = (v: number) => H - 6 - (v / max) * (H - 18);
  const line = (vs: number[]) => vs.filter((_, i) => i % 5 === 0 || i === vs.length - 1).map((v, k, arr) => `${k ? 'L' : 'M'}${x(k === arr.length - 1 ? 1439 : k * 5).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = (vs: number[]) => `${line(vs)} L${W} ${H - 6} L0 ${H - 6} Z`;
  return (
    <figure className="chart">
      <figcaption>
        <b>People in the ED</b>
        <span><i className="c-scen" /> this scenario</span>
        <span><i className="c-base" /> baseline</span>
        <span><i className="c-board" /> waiting for a bed</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onScrub(Math.round(((e.clientX - r.left) / r.width) * 1439));
        }}
        role="img"
        aria-label="People in the emergency department through the day"
      >
        {[6, 12, 18].map((h) => <line key={h} x1={x(h * 60)} x2={x(h * 60)} y1={0} y2={H} className="grid" />)}
        <path d={area(board(scen))} className="c-board-a" />
        <path d={line(total(base))} className="c-base-l" vectorEffect="non-scaling-stroke" />
        <path d={line(total(scen))} className="c-scen-l" vectorEffect="non-scaling-stroke" />
        <line x1={x(m)} x2={x(m)} y1={0} y2={H} className="ph" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
    </figure>
  );
}
