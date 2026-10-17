/**
 * A day of patient flow through a small hospital: emergency department (ED) arrivals, assessment
 * by ED doctors, admission to a medical ward when a bed is free, and ward discharges that free those
 * beds. A minute-by-minute simulation with a seeded random number generator, so a scenario and the
 * baseline see exactly the same patients (common random numbers) and any difference comes from the lever.
 *
 * Deliberately simple and written down, so every assumption can be read and argued with.
 */

export interface Levers {
  doctors: number; // ED doctors on duty
  escalationBeds: number; // extra ward beds opened
  dischargeBeforeNoon: boolean; // ward policy: move discharges earlier in the day
  dischargeLounge: boolean; // discharged patients wait for transport in a lounge, freeing the bed
}

export const BASELINE: Levers = { doctors: 4, escalationBeds: 0, dischargeBeforeNoon: false, dischargeLounge: false };

export const DAY = 1440;
export const WARD_BEDS = 40;
export const START_OCCUPIED = 39;
export const ADMIT_RATE = 0.3;
export const TURNAROUND = 30; // minutes to clean a bed
export const FOUR_HOURS = 240;
export const LOUNGE_GAIN = 90; // a lounge frees the bed this much earlier, for discharges after 10:00

/** ED arrivals per hour, a typical weekday shape. */
export const ARRIVALS_PER_HOUR = [3, 2.5, 2, 2, 2, 2.5, 3, 4, 5, 6, 6.5, 6.5, 6, 6, 6, 6, 6, 6, 5.5, 5, 4.5, 4, 3.5, 3];

/** When ward discharges happen, weight per hour: most late in the afternoon, as on most wards. */
export const DISCHARGE_HOURS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0.6, 1, 1.4, 1.8, 2.2, 2.6, 2.6, 2.2, 1.6, 1, 0.5, 0.2, 0, 0];
/** With a discharge-before-noon policy, the same discharges, a third of them before 12:00. */
export const DISCHARGE_HOURS_NOON = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1.2, 2.2, 2.6, 2.2, 1.8, 1.6, 1.6, 1.4, 1.1, 0.8, 0.5, 0.3, 0.1, 0, 0];
export const DISCHARGES = 32;

/** Mulberry32: small, fast, seedable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(r: () => number): number {
  const u = Math.max(1e-9, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Minutes from the start of the hour, by inverse sampling from hourly weights. */
function sampleFromHours(weights: number[], u: number): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let h = 0; h < weights.length; h++) {
    const w = weights[h] / total;
    if (u < acc + w) return Math.floor(h * 60 + ((u - acc) / w) * 60);
    acc += w;
  }
  return DAY - 1;
}

export interface Patient {
  id: number;
  arrive: number;
  assessMinutes: number;
  admit: boolean;
  // filled in by the simulation
  seen?: number; // assessment starts
  decided?: number; // assessment ends
  bed?: number; // moves to a ward bed
  left?: number; // leaves the ED (home or to the ward)
  bedIndex?: number;
}

export interface Discharge {
  id: number;
  at: number; // the patient is ready to go
  freed: number; // the bed is free to clean (earlier with a lounge)
  bedIndex: number;
}

/** The same day for every scenario: arrivals, assessment times, who needs a bed, and discharge readiness. */
export function day(seed = 7): { patients: Patient[]; dischargeU: number[] } {
  const r = rng(seed);
  const patients: Patient[] = [];
  let id = 0;
  for (let m = 0; m < DAY; m++) {
    const lambda = ARRIVALS_PER_HOUR[Math.floor(m / 60)] / 60;
    if (r() < lambda) {
      const assess = Math.round(Math.min(240, Math.max(15, Math.exp(Math.log(45) + 0.5 * normal(r)))));
      patients.push({ id: id++, arrive: m, assessMinutes: assess, admit: r() < ADMIT_RATE });
    }
  }
  const dischargeU = Array.from({ length: DISCHARGES }, () => r()).sort((a, b) => a - b);
  return { patients, dischargeU };
}

export interface BedEvent {
  bed: number;
  from: number;
  to: number;
  kind: 'occupied' | 'cleaning';
  patient?: number; // ED patient id for admissions
}

export interface Result {
  levers: Levers;
  patients: Patient[];
  discharges: Discharge[];
  beds: number;
  bedEvents: BedEvent[];
  /** ED patients each minute: waiting, being seen, boarding (decided to admit, no bed) */
  census: Array<{ waiting: number; seen: number; boarding: number; wardFree: number }>;
}

export function simulate(levers: Levers, seed = 7): Result {
  const { patients: template, dischargeU } = day(seed);
  const patients = template.map((p) => ({ ...p }));
  const beds = WARD_BEDS + levers.escalationBeds;
  const hours = levers.dischargeBeforeNoon ? DISCHARGE_HOURS_NOON : DISCHARGE_HOURS;

  // bed state: minute the bed becomes free (Infinity while occupied by someone not leaving today)
  const freeAt: number[] = Array.from({ length: beds }, (_, i) => (i < START_OCCUPIED ? Infinity : 0));
  const bedEvents: BedEvent[] = [];
  const occupiedSince: number[] = Array.from({ length: beds }, (_, i) => (i < START_OCCUPIED ? 0 : -1));

  // discharges: the same readiness quantiles, mapped through the policy's hours, on the longest-staying beds first
  const discharges: Discharge[] = dischargeU.map((u, i) => {
    const at = sampleFromHours(hours, u);
    const freed = levers.dischargeLounge && at >= 600 ? Math.max(600, at - LOUNGE_GAIN) : at;
    return { id: i, at, freed, bedIndex: i };
  });
  const dischargeAt = new Map(discharges.map((d) => [d.bedIndex, d.freed]));

  const waiting: Patient[] = [];
  const boarding: Patient[] = [];
  const busyUntil: number[] = Array.from({ length: levers.doctors }, () => 0);
  const census: Result['census'] = [];
  let next = 0;

  const occupy = (b: number, m: number, p?: Patient) => {
    occupiedSince[b] = m;
    freeAt[b] = Infinity;
    if (p) {
      p.bed = m;
      p.left = m;
      p.bedIndex = b;
    }
  };

  for (let m = 0; m < DAY; m++) {
    // discharges free beds, which are cleaned before reuse
    for (let b = 0; b < beds; b++) {
      if (dischargeAt.get(b) === m && occupiedSince[b] >= 0 && freeAt[b] === Infinity) {
        bedEvents.push({ bed: b, from: occupiedSince[b], to: m, kind: 'occupied' });
        bedEvents.push({ bed: b, from: m, to: m + TURNAROUND, kind: 'cleaning' });
        occupiedSince[b] = -1;
        freeAt[b] = m + TURNAROUND;
        dischargeAt.delete(b);
      }
    }
    while (next < patients.length && patients[next].arrive === m) waiting.push(patients[next++]);

    // doctors finish assessments
    for (const p of patients) {
      if (p.decided === m) {
        if (p.admit) boarding.push(p);
        else p.left = m;
      }
    }
    // free doctors see the next waiting patient, first come first served
    for (let d = 0; d < busyUntil.length; d++) {
      if (busyUntil[d] <= m && waiting.length) {
        const p = waiting.shift()!;
        p.seen = m;
        p.decided = m + p.assessMinutes;
        busyUntil[d] = p.decided;
      }
    }
    // admitted patients go to the free beds, longest-boarding first
    for (let b = 0; b < beds && boarding.length; b++) {
      if (occupiedSince[b] < 0 && freeAt[b] <= m) {
        occupy(b, m, boarding.shift()!);
      }
    }
    census.push({
      waiting: waiting.length,
      seen: busyUntil.filter((u) => u > m).length,
      boarding: boarding.length,
      wardFree: freeAt.filter((f, b) => occupiedSince[b] < 0 && f <= m).length,
    });
  }
  // close the beds still occupied at midnight
  for (let b = 0; b < beds; b++) if (occupiedSince[b] >= 0) bedEvents.push({ bed: b, from: occupiedSince[b], to: DAY, kind: 'occupied' });
  return { levers, patients, discharges, beds, bedEvents, census };
}

// ---- measures ------------------------------------------------------------------------

/** Time in the ED: to leaving, or to the end of the day for anyone still there. */
export const edMinutes = (p: Patient) => (p.left ?? DAY) - p.arrive;

export interface Metrics {
  attendances: number;
  admissions: number;
  within4h: number; // share of attendances that left the ED within 4 hours (or would have at midnight)
  breaches: number;
  longestWait: number; // minutes
  boardingHours: number; // total hours admitted patients waited in the ED for a bed
  waitingForDoctor: number; // mean minutes from arrival to being seen
  peakInEd: number;
  stillWaitingForBed: number; // at midnight
}

export function metrics(r: Result): Metrics {
  const ps = r.patients;
  const breaches = ps.filter((p) => edMinutes(p) > FOUR_HOURS).length;
  const boarding = ps.filter((p) => p.admit && p.decided !== undefined).reduce((a, p) => a + (Math.min(p.left ?? DAY, DAY) - p.decided!), 0);
  const seen = ps.filter((p) => p.seen !== undefined);
  return {
    attendances: ps.length,
    admissions: ps.filter((p) => p.admit).length,
    within4h: ps.length ? (ps.length - breaches) / ps.length : 1,
    breaches,
    longestWait: Math.max(0, ...ps.map(edMinutes)),
    boardingHours: boarding / 60,
    waitingForDoctor: seen.length ? seen.reduce((a, p) => a + (p.seen! - p.arrive), 0) / seen.length : 0,
    peakInEd: Math.max(...r.census.map((c) => c.waiting + c.seen + c.boarding)),
    stillWaitingForBed: ps.filter((p) => p.admit && p.decided !== undefined && p.left === undefined).length,
  };
}

/** Where each ED patient is at minute m. */
export type Where = 'waiting' | 'seen' | 'boarding' | 'gone';
export function whereAt(p: Patient, m: number): Where | null {
  if (p.arrive > m) return null;
  if (p.left !== undefined && p.left <= m) return 'gone';
  if (p.seen === undefined || p.seen > m) return 'waiting';
  if (p.decided! > m) return 'seen';
  return 'boarding';
}

/** The state of each ward bed at minute m. */
export function bedAt(r: Result, b: number, m: number): 'occupied' | 'cleaning' | 'free' | 'new' {
  const admitted = r.patients.find((p) => p.bedIndex === b && p.bed !== undefined && p.bed <= m);
  const ev = r.bedEvents.filter((e) => e.bed === b && e.from <= m && m < e.to);
  if (ev.some((e) => e.kind === 'cleaning')) return 'cleaning';
  if (admitted) return m - admitted.bed! < 60 ? 'new' : 'occupied';
  if (ev.some((e) => e.kind === 'occupied')) return 'occupied';
  return 'free';
}

// ---- the days on offer, and where to spend the next resource ----------------------------

export const DAYS: Array<{ id: string; label: string; seed: number; note: string }> = [
  { id: 'mon', label: 'Monday', seed: 42, note: 'Busy front door and a full ward' },
  { id: 'tue', label: 'Tuesday', seed: 20, note: 'Beds to spare, too few doctors' },
  { id: 'wed', label: 'Wednesday', seed: 16, note: 'Doctors keep up, beds do not' },
];

export interface Move {
  id: string;
  label: string;
  levers: Levers;
  within4h: number; // change in share within 4 hours, in percentage points
  boardingHours: number; // change in boarding hours
}

/** Each single move from the current levers, scored on the same day, best first. */
export function bestMoves(current: Levers, seed: number): Move[] {
  const base = metrics(simulate(current, seed));
  const options: Array<[string, string, Levers]> = [
    ['doctor', 'One more ED doctor', { ...current, doctors: current.doctors + 1 }],
    ['beds', 'Open 2 escalation beds', { ...current, escalationBeds: current.escalationBeds + 2 }],
    ['noon', 'Discharge before noon', { ...current, dischargeBeforeNoon: true }],
    ['lounge', 'Open the discharge lounge', { ...current, dischargeLounge: true }],
  ];
  return options
    .filter(([id]) => !(id === 'noon' && current.dischargeBeforeNoon) && !(id === 'lounge' && current.dischargeLounge) && !(id === 'doctor' && current.doctors >= 7) && !(id === 'beds' && current.escalationBeds >= 6))
    .map(([id, label, levers]) => {
      const m = metrics(simulate(levers, seed));
      return { id, label, levers, within4h: (m.within4h - base.within4h) * 100, boardingHours: m.boardingHours - base.boardingHours };
    })
    .sort((a, b) => b.within4h - a.within4h || a.boardingHours - b.boardingHours);
}

/** The minute with the most people in the ED, for opening the twin where it matters. */
export function busiestMinute(r: Result): number {
  let best = 0;
  r.census.forEach((c, i) => {
    const n = c.waiting + c.seen + c.boarding;
    const b = r.census[best];
    if (n > b.waiting + b.seen + b.boarding) best = i;
  });
  return best;
}
