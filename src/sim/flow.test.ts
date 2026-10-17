import { describe, expect, it } from 'vitest';
import {
  BASELINE, DAY, DAYS, busiestMinute, DISCHARGE_HOURS, DISCHARGE_HOURS_NOON, FOUR_HOURS, START_OCCUPIED, WARD_BEDS, bedAt, bestMoves, day, edMinutes, metrics, rng, simulate, whereAt,
} from './flow';

const MON = DAYS[0].seed;

describe('the random day', () => {
  it('is the same every time for the same seed, and different for another', () => {
    expect(day(MON)).toEqual(day(MON));
    expect(day(MON)).not.toEqual(day(MON + 1));
    const r = rng(1);
    const xs = Array.from({ length: 1000 }, r);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
  });

  it('brings a typical weekday: about 110 attendances, about a third admitted', () => {
    for (const d of DAYS) {
      const { patients } = day(d.seed);
      expect(patients.length).toBeGreaterThan(100);
      expect(patients.length).toBeLessThan(120);
      const adm = patients.filter((p) => p.admit).length / patients.length;
      expect(adm).toBeGreaterThan(0.25);
      expect(adm).toBeLessThan(0.36);
    }
  });

  it('moves a third of discharges before noon under the noon policy, against about one in ten without it', () => {
    const before = (h: number[]) => h.slice(0, 12).reduce((a, b) => a + b, 0) / h.reduce((a, b) => a + b, 0);
    expect(before(DISCHARGE_HOURS)).toBeLessThan(0.15);
    expect(before(DISCHARGE_HOURS_NOON)).toBeGreaterThan(0.3);
  });
});

describe('the simulation', () => {
  const r = simulate(BASELINE, MON);

  it('accounts for every patient: still waiting, being seen, boarding, or gone', () => {
    const at = DAY - 1;
    const counts = { waiting: 0, seen: 0, boarding: 0, gone: 0 };
    for (const p of r.patients) counts[whereAt(p, at)!]++;
    expect(counts.waiting + counts.seen + counts.boarding + counts.gone).toBe(r.patients.length);
    const c = r.census[at];
    expect([c.waiting, c.boarding]).toEqual([counts.waiting, counts.boarding]);
  });

  it('keeps the order of events for every patient', () => {
    for (const p of r.patients) {
      if (p.seen !== undefined) expect(p.seen).toBeGreaterThanOrEqual(p.arrive);
      if (p.decided !== undefined) expect(p.decided).toBe(p.seen! + p.assessMinutes);
      if (p.left !== undefined) expect(p.left).toBeGreaterThanOrEqual(p.decided!);
      if (!p.admit && p.left !== undefined) expect(p.left).toBe(p.decided);
    }
  });

  it('sees patients first come, first served', () => {
    const seen = r.patients.filter((p) => p.seen !== undefined).sort((a, b) => a.arrive - b.arrive || a.id - b.id);
    for (let i = 1; i < seen.length; i++) expect(seen[i].seen!).toBeGreaterThanOrEqual(seen[i - 1].seen!);
  });

  it('never puts two patients in one bed, and cleans a bed before reuse', () => {
    const admitted = r.patients.filter((p) => p.bedIndex !== undefined);
    const used = new Set(admitted.map((p) => p.bedIndex));
    expect(used.size).toBe(admitted.length);
    for (const p of admitted) {
      const cleaned = r.bedEvents.find((e) => e.bed === p.bedIndex && e.kind === 'cleaning');
      if (cleaned) expect(p.bed!).toBeGreaterThanOrEqual(cleaned.to);
      expect(bedAt(r, p.bedIndex!, p.bed!)).toBe('new');
    }
  });

  it('never has more doctors busy than on duty, or more beds than exist', () => {
    for (const c of r.census) {
      expect(c.seen).toBeLessThanOrEqual(BASELINE.doctors);
      expect(c.wardFree).toBeLessThanOrEqual(WARD_BEDS - START_OCCUPIED + BASELINE.escalationBeds + 32);
    }
  });

  it('counts a breach as more than 4 hours in the ED, including anyone still there at midnight', () => {
    const m = metrics(r);
    expect(m.breaches).toBe(r.patients.filter((p) => edMinutes(p) > FOUR_HOURS).length);
    expect(m.within4h).toBeCloseTo(1 - m.breaches / m.attendances);
  });
});

describe('levers', () => {
  const m = (l: Partial<typeof BASELINE>, seed = MON) => metrics(simulate({ ...BASELINE, ...l }, seed));

  it('more doctors shorten the wait to be seen, every day', () => {
    for (const d of DAYS) expect(m({ doctors: 5 }, d.seed).waitingForDoctor).toBeLessThan(m({}, d.seed).waitingForDoctor);
  });

  it('more doctors cannot fix a full ward: on Wednesday they add boarding and save no breaches', () => {
    const wed = DAYS[2].seed;
    expect(m({ doctors: 5 }, wed).within4h).toBeCloseTo(m({}, wed).within4h, 5);
    expect(m({ doctors: 5 }, wed).boardingHours).toBeGreaterThan(m({}, wed).boardingHours);
  });

  it('earlier discharges cut boarding on the days the ward is the constraint', () => {
    for (const d of [DAYS[0], DAYS[2]]) expect(m({ dischargeBeforeNoon: true }, d.seed).boardingHours).toBeLessThan(m({}, d.seed).boardingHours);
  });

  it('escalation beds never make boarding worse', () => {
    for (const d of DAYS) expect(m({ escalationBeds: 4 }, d.seed).boardingHours).toBeLessThanOrEqual(m({}, d.seed).boardingHours);
  });

  it('a lounge only ever frees beds earlier', () => {
    const a = simulate(BASELINE, MON).discharges;
    const b = simulate({ ...BASELINE, dischargeLounge: true }, MON).discharges;
    a.forEach((d, i) => expect(b[i].freed).toBeLessThanOrEqual(d.freed));
  });
});

describe('the best move today', () => {
  it('is a doctor on Tuesday and a ward change on Wednesday', () => {
    expect(bestMoves(BASELINE, DAYS[1].seed)[0].id).toBe('doctor');
    expect(['noon', 'beds', 'lounge']).toContain(bestMoves(BASELINE, DAYS[2].seed)[0].id);
  });

  it('does not offer a move already made', () => {
    const ids = bestMoves({ ...BASELINE, dischargeBeforeNoon: true, dischargeLounge: true }, MON).map((x) => x.id);
    expect(ids).not.toContain('noon');
    expect(ids).not.toContain('lounge');
  });
});

describe('opening view', () => {
  it('opens each day at its busiest minute in the ED', () => {
    for (const d of DAYS) {
      const r = simulate(BASELINE, d.seed);
      const at = busiestMinute(r);
      const n = (i: number) => r.census[i].waiting + r.census[i].seen + r.census[i].boarding;
      expect(n(at)).toBe(Math.max(...r.census.map((_, i) => n(i))));
    }
  });
});
