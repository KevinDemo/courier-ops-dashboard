export const STATUSES = ["Unassigned", "Assigned", "PickedUp", "InTransit", "Delivered", "Failed"] as const;
export type JobStatus = (typeof STATUSES)[number];

export const SERVICES = ["Standard", "Express", "SameDay"] as const;
export type ServiceLevel = (typeof SERVICES)[number];

export interface JobRow {
  id: number;
  number: string;
  customer: string;
  pickupSuburb: string;
  deliverySuburb: string;
  service: ServiceLevel;
  status: JobStatus;
  driverId: number | null;
  driver: string | null;
  readyAt: string;
  dueAt: string;
  deliveredAt: string | null;
  isLate: boolean;
}

export interface JobEvent {
  at: string;
  status: JobStatus;
  note: string;
}

export interface JobDetail {
  job: JobRow;
  pieces: number;
  weightKg: number;
  vehicle: string | null;
  events: JobEvent[];
}

export interface Kpis {
  jobsToday: number;
  onTimePercent: number | null;
  delivered: number;
  late: number;
  unassigned: number;
  failed: number;
}

export interface HourBucket {
  hour: number;
  onTime: number;
  late: number;
  open: number;
  failed: number;
}

export type SortColumn = "number" | "customer" | "route" | "service" | "driver" | "readyAt" | "dueAt" | "status";

export interface JobQuery {
  q?: string;
  status?: JobStatus;
  service?: ServiceLevel;
  driverId?: number;
  lateOnly?: boolean;
  sort: SortColumn;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

export interface PagedJobs {
  items: JobRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Driver {
  id: number;
  name: string;
}

export interface JobChanged {
  id: number;
  number: string;
  customer: string;
  status: JobStatus;
  driver: string | null;
  at: string;
}

export type Connection = "live" | "reconnecting" | "offline";

export class AuthError extends Error {}

/** Everything the screens need. The real API and the bundled demo data both implement it. */
export interface DataSource {
  readonly isDemo: boolean;
  me(): Promise<string>;
  login(email: string, password: string): Promise<string>;
  logout(): Promise<void>;
  getKpis(): Promise<Kpis>;
  getHourly(): Promise<HourBucket[]>;
  getDrivers(): Promise<Driver[]>;
  getJobs(query: JobQuery): Promise<PagedJobs>;
  getJob(id: number): Promise<JobDetail>;
  subscribe(onChange: (change: JobChanged) => void, onConnection: (state: Connection) => void): () => void;
}
