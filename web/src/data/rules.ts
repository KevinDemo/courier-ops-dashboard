import { STATUSES, type HourBucket, type JobQuery, type JobRow, type Kpis, type PagedJobs } from "../types";

export type RuleJob = Pick<JobRow, "status" | "readyAt" | "dueAt" | "deliveredAt">;

const time = (iso: string) => new Date(iso).getTime();

/** Demo mode only. Mirrors JobRules.IsLate on the server, and tests-shared/kpi-fixture.json holds both to the same answers. */
export function isLate(job: RuleJob, now: Date): boolean {
  if (job.status === "Delivered") return job.deliveredAt !== null && time(job.deliveredAt) > time(job.dueAt);
  return job.status !== "Failed" && time(job.dueAt) < now.getTime();
}

export function computeKpis(jobs: RuleJob[], now: Date, dayStart: Date, dayEnd: Date): Kpis {
  const today = jobs.filter((j) => time(j.readyAt) >= dayStart.getTime() && time(j.readyAt) < dayEnd.getTime());
  const delivered = today.filter((j) => j.status === "Delivered");
  const onTime = delivered.filter((j) => !isLate(j, now)).length;
  return {
    jobsToday: today.length,
    delivered: delivered.length,
    onTimePercent: delivered.length === 0 ? null : Math.round((1000 * onTime) / delivered.length) / 10,
    late: today.filter((j) => isLate(j, now)).length,
    unassigned: today.filter((j) => j.status === "Unassigned").length,
    failed: today.filter((j) => j.status === "Failed").length,
  };
}

export function computeHourly(jobs: RuleJob[], now: Date): HourBucket[] {
  if (jobs.length === 0) return [];
  const hourOf = (j: RuleJob) => new Date(j.readyAt).getHours();
  const hours = jobs.map(hourOf);
  const buckets: HourBucket[] = [];
  for (let hour = Math.min(...hours); hour <= Math.max(...hours); hour++) {
    const inHour = jobs.filter((j) => hourOf(j) === hour);
    const failed = inHour.filter((j) => j.status === "Failed").length;
    const late = inHour.filter((j) => isLate(j, now)).length;
    const onTime = inHour.filter((j) => j.status === "Delivered" && !isLate(j, now)).length;
    buckets.push({ hour, onTime, late, failed, open: inHour.length - onTime - late - failed });
  }
  return buckets;
}

function compare(a: string | number | null, b: string | number | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

const sortValue: Record<JobQuery["sort"], (j: JobRow) => string | number | null> = {
  number: (j) => j.number,
  customer: (j) => j.customer,
  route: (j) => j.pickupSuburb,
  service: (j) => j.service,
  driver: (j) => j.driver,
  readyAt: (j) => time(j.readyAt),
  dueAt: (j) => time(j.dueAt),
  status: (j) => STATUSES.indexOf(j.status),
};

/** What the API does in SQL, done over the bundled rows so demo mode behaves the same. */
export function queryJobs(jobs: JobRow[], query: JobQuery): PagedJobs {
  const q = query.q?.trim().toLowerCase();
  const matches = jobs.filter((j) => {
    if (query.status && j.status !== query.status) return false;
    if (query.service && j.service !== query.service) return false;
    if (query.driverId && j.driverId !== query.driverId) return false;
    if (query.lateOnly && !j.isLate) return false;
    if (q) return [j.number, j.customer, j.pickupSuburb, j.deliverySuburb, j.driver ?? ""].some((v) => v.toLowerCase().includes(q));
    return true;
  });

  const direction = query.dir === "desc" ? -1 : 1;
  const key = sortValue[query.sort];
  const sorted = [...matches].sort((a, b) => direction * compare(key(a), key(b)) || a.id - b.id);

  const start = (query.page - 1) * query.pageSize;
  return { items: sorted.slice(start, start + query.pageSize), total: matches.length, page: query.page, pageSize: query.pageSize };
}
