import { AuthError, type Connection, type DataSource, type JobChanged, type JobQuery } from "../types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  if (response.status === 401) throw new AuthError("Not signed in.");
  if (!response.ok) throw new Error(`${path} returned ${response.status}.`);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export function toQueryString(query: JobQuery): string {
  const params = new URLSearchParams({ sort: query.sort, dir: query.dir, page: String(query.page), pageSize: String(query.pageSize) });
  if (query.q?.trim()) params.set("q", query.q.trim());
  if (query.status) params.set("status", query.status);
  if (query.service) params.set("service", query.service);
  if (query.driverId) params.set("driverId", String(query.driverId));
  if (query.lateOnly) params.set("lateOnly", "true");
  return params.toString();
}

export const apiSource: DataSource = {
  isDemo: false,
  me: async () => (await request<{ email: string }>("/api/auth/me")).email,
  login: async (email, password) =>
    (await request<{ email: string }>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })).email,
  logout: () => request("/api/auth/logout", { method: "POST" }),
  getKpis: () => request("/api/kpis"),
  getHourly: () => request("/api/charts/hourly"),
  getDrivers: () => request("/api/drivers"),
  getJobs: (query) => request(`/api/jobs?${toQueryString(query)}`),
  getJob: (id) => request(`/api/jobs/${id}`),
  subscribe(onChange: (change: JobChanged) => void, onConnection: (state: Connection) => void) {
    let stopped = false;
    let stop = () => {};
    // Loaded here so the demo build does not carry the SignalR client.
    void import("@microsoft/signalr").then(async ({ HubConnectionBuilder }) => {
      if (stopped) return;
      const connection = new HubConnectionBuilder().withUrl("/hubs/ops").withAutomaticReconnect().build();
      connection.on("jobChanged", onChange);
      connection.onreconnecting(() => onConnection("reconnecting"));
      connection.onreconnected(() => onConnection("live"));
      connection.onclose(() => onConnection("offline"));
      stop = () => void connection.stop();
      try {
        await connection.start();
        onConnection("live");
      } catch {
        onConnection("offline");
      }
    });
    return () => {
      stopped = true;
      stop();
    };
  },
};
