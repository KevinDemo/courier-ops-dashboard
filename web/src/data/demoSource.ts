import { SERVICES, type DataSource, type Driver, type JobChanged, type JobDetail, type JobEvent, type JobRow, type JobStatus } from "../types";
import { computeHourly, computeKpis, isLate, queryJobs } from "./rules";

const DRIVERS: (Driver & { vehicle: string })[] = [
  { id: 1, name: "Priya Nair", vehicle: "Van HF-12" },
  { id: 2, name: "Tomas Reyes", vehicle: "Van HF-07" },
  { id: 3, name: "Aroha Wells", vehicle: "Truck HF-21" },
  { id: 4, name: "Sam Whitlock", vehicle: "Van HF-15" },
  { id: 5, name: "Lena Hoang", vehicle: "Bike HF-33" },
  { id: 6, name: "Marcus Doyle", vehicle: "Truck HF-24" },
  { id: 7, name: "Ines Kovac", vehicle: "Van HF-09" },
  { id: 8, name: "Theo Barnes", vehicle: "Van HF-18" },
];

const CUSTOMERS = [
  "Bellbird Ceramics", "Wattle Cove Homewares", "Kingsbrae Stone", "Quillon Medical Supply", "Tern Bay Tyre and Fleet", "Slipway Mechanical",
  "Oyster Lane Print", "Eastmere Pharmacy Group", "Saltmarsh Coffee Roasters", "Port Harlow Marine", "Ironbark Joinery", "Fernleigh Florists",
];

const SUBURBS = ["Port Harlow", "Eastmere", "Kingsbrae", "Wattle Cove", "Tern Bay", "Saltmarsh", "Oyster Point", "Fernleigh", "Ironbark Hill", "Slipway"];

const NOTE: Record<JobStatus, string> = {
  Unassigned: "Booked",
  Assigned: "Assigned to driver",
  PickedUp: "Picked up",
  InTransit: "In transit",
  Delivered: "Delivered",
  Failed: "Delivery failed: nobody on site",
};

interface DemoJob extends JobRow {
  pieces: number;
  weightKg: number;
  events: JobEvent[];
}

/** A small seeded generator, so one day's demo data is the same on every visit. */
function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

export function generateJobs(now: Date, count = 160): DemoJob[] {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const random = seededRandom(dayStart.getFullYear() * 10000 + (dayStart.getMonth() + 1) * 100 + dayStart.getDate());
  const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)];
  const nowMs = now.getTime();
  const stamp = `${String(dayStart.getFullYear()).slice(2)}${String(dayStart.getMonth() + 1).padStart(2, "0")}${String(dayStart.getDate()).padStart(2, "0")}`;

  return Array.from({ length: count }, (_, i) => {
    const ready = new Date(dayStart);
    ready.setHours(6 + Math.floor(random() * 12), Math.floor(random() * 12) * 5);
    const readyMs = ready.getTime();
    const service = pick(SERVICES);
    const dueMs = readyMs + (service === "Express" ? 2 : service === "SameDay" ? 4 : 6) * 3600_000;

    const roll = random();
    let status: JobStatus;
    if (dueMs < nowMs) status = roll < 0.9 ? "Delivered" : roll < 0.94 ? "Failed" : "InTransit";
    else if (readyMs > nowMs) status = roll < 0.65 ? "Unassigned" : "Assigned";
    else status = roll < 0.1 ? "Unassigned" : roll < 0.3 ? "Assigned" : roll < 0.55 ? "PickedUp" : roll < 0.85 ? "InTransit" : "Delivered";

    const driver = status === "Unassigned" ? null : pick(DRIVERS);
    const finishedMs = Math.min(nowMs, readyMs + (dueMs - readyMs) * (0.45 + random() * 0.7));
    const events: JobEvent[] = [{ at: iso(Math.min(nowMs, readyMs - 20 * 60_000)), status: "Unassigned", note: NOTE.Unassigned }];
    const step = (s: JobStatus, fraction: number) => {
      events.push({ at: iso(Math.min(nowMs, readyMs + (finishedMs - readyMs) * fraction)), status: s, note: NOTE[s] });
    };
    if (status !== "Unassigned") step("Assigned", 0.05);
    if (status === "PickedUp" || status === "InTransit" || status === "Delivered" || status === "Failed") step("PickedUp", 0.3);
    if (status === "InTransit" || status === "Delivered" || status === "Failed") step("InTransit", 0.5);
    if (status === "Delivered" || status === "Failed") step(status, 1);

    const job: DemoJob = {
      id: i + 1,
      number: `HF${stamp}${String(i + 1).padStart(3, "0")}`,
      customer: pick(CUSTOMERS),
      pickupSuburb: pick(SUBURBS),
      deliverySuburb: pick(SUBURBS),
      service,
      status,
      driverId: driver?.id ?? null,
      driver: driver?.name ?? null,
      readyAt: iso(readyMs),
      dueAt: iso(dueMs),
      deliveredAt: status === "Delivered" ? iso(finishedMs) : null,
      isLate: false,
      pieces: 1 + Math.floor(random() * 8),
      weightKg: Math.round((random() * 80 + 0.5) * 10) / 10,
      events,
    };
    job.isLate = isLate(job, now);
    return job;
  });
}

const NEXT: Partial<Record<JobStatus, JobStatus>> = { Unassigned: "Assigned", Assigned: "PickedUp", PickedUp: "InTransit", InTransit: "Delivered" };

export interface DemoOptions {
  now?: () => Date;
  tickMs?: number;
}

export type DemoSource = DataSource & { tick(): JobChanged };

/** The whole backend in the browser, for the static GitHub Pages build. Nothing leaves the page. */
export function createDemoSource({ now = () => new Date(), tickMs = 3500 }: DemoOptions = {}): DemoSource {
  const jobs = generateJobs(now());
  const random = seededRandom(now().getTime());

  const window = () => {
    const today = now();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return [start, new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)] as const;
  };

  const withLate = (job: DemoJob) => {
    job.isLate = isLate(job, now());
    return job;
  };

  const source: DemoSource = {
    isDemo: true,
    me: async () => "demo@harbourfreight.example",
    login: async () => "demo@harbourfreight.example",
    logout: async () => {},
    getKpis: async () => {
      const [start, end] = window();
      return computeKpis(jobs, now(), start, end);
    },
    getHourly: async () => computeHourly(jobs, now()),
    getDrivers: async () => DRIVERS.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    getJobs: async (query) => queryJobs(jobs.map(withLate), query),
    getJob: async (id): Promise<JobDetail> => {
      const job = jobs.find((j) => j.id === id);
      if (!job) throw new Error(`No job ${id}.`);
      return {
        job: withLate(job),
        pieces: job.pieces,
        weightKg: job.weightKg,
        vehicle: DRIVERS.find((d) => d.id === job.driverId)?.vehicle ?? null,
        events: job.events,
      };
    },
    tick() {
      const open = jobs.filter((j) => NEXT[j.status]);
      let job = open[Math.floor(random() * open.length)];
      const at = iso(now().getTime());
      if (!job) {
        // Late in the day everything is finished, so a new booking keeps the demo moving.
        const template = jobs[jobs.length - 1];
        job = {
          ...template,
          id: jobs.length + 1,
          number: `${template.number.slice(0, 8)}${String(jobs.length + 1).padStart(3, "0")}`,
          status: "Unassigned",
          driverId: null,
          driver: null,
          readyAt: at,
          dueAt: iso(now().getTime() + 2 * 3600_000),
          deliveredAt: null,
          events: [{ at, status: "Unassigned", note: NOTE.Unassigned }],
        };
        jobs.push(job);
      }
      const next = NEXT[job.status]!;
      job.status = next === "Delivered" && random() < 0.04 ? "Failed" : next;
      if (job.status === "Assigned") {
        const driver = DRIVERS[Math.floor(random() * DRIVERS.length)];
        job.driverId = driver.id;
        job.driver = driver.name;
      }
      if (job.status === "Delivered") job.deliveredAt = at;
      job.events = [...job.events, { at, status: job.status, note: NOTE[job.status] }];
      return { id: job.id, number: job.number, customer: job.customer, status: job.status, driver: job.driver, at };
    },
    subscribe(onChange, onConnection) {
      onConnection("live");
      const timer = setInterval(() => onChange(source.tick()), tickMs);
      return () => clearInterval(timer);
    },
  };
  return source;
}
