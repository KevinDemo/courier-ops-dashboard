import { useEffect, useState } from "react";
import { SERVICE_LABEL, STATUS_LABEL, formatTime } from "../format";
import { SERVICES, STATUSES, type Driver, type JobQuery, type JobStatus, type PagedJobs, type ServiceLevel, type SortColumn } from "../types";

const COLUMNS: { key: SortColumn; label: string }[] = [
  { key: "number", label: "Job" },
  { key: "customer", label: "Customer" },
  { key: "route", label: "Route" },
  { key: "service", label: "Service" },
  { key: "driver", label: "Driver" },
  { key: "dueAt", label: "Due" },
  { key: "status", label: "Status" },
];

interface Props {
  page: PagedJobs | null;
  query: JobQuery;
  drivers: Driver[];
  changed: ReadonlySet<number>;
  onQuery: (patch: Partial<JobQuery>) => void;
  onOpen: (id: number) => void;
}

export function JobsTable({ page, query, drivers, changed, onQuery, onOpen }: Props) {
  const [search, setSearch] = useState(query.q ?? "");

  // Wait for a pause in typing, so each keystroke is not a server query.
  useEffect(() => {
    if (search === (query.q ?? "")) return;
    const timer = setTimeout(() => onQuery({ q: search, page: 1 }), 250);
    return () => clearTimeout(timer);
  }, [search, query.q, onQuery]);

  const sortBy = (key: SortColumn) =>
    onQuery({ sort: key, dir: query.sort === key && query.dir === "asc" ? "desc" : "asc", page: 1 });

  const lastPage = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;
  const hasFilters = Boolean(query.q || query.status || query.service || query.driverId || query.lateOnly);

  return (
    <section className="panel jobs" aria-label="Jobs">
      <div className="filters">
        <input
          type="search"
          aria-label="Search jobs"
          placeholder="Search job, customer, suburb, driver"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Status" value={query.status ?? ""} onChange={(e) => onQuery({ status: (e.target.value || undefined) as JobStatus | undefined, page: 1 })}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select aria-label="Service" value={query.service ?? ""} onChange={(e) => onQuery({ service: (e.target.value || undefined) as ServiceLevel | undefined, page: 1 })}>
          <option value="">All services</option>
          {SERVICES.map((s) => <option key={s} value={s}>{SERVICE_LABEL[s]}</option>)}
        </select>
        <select aria-label="Driver" value={query.driverId ?? ""} onChange={(e) => onQuery({ driverId: e.target.value ? Number(e.target.value) : undefined, page: 1 })}>
          <option value="">All drivers</option>
          {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <label className="toggle">
          <input type="checkbox" checked={Boolean(query.lateOnly)} onChange={(e) => onQuery({ lateOnly: e.target.checked || undefined, page: 1 })} />
          Late only
        </label>
        {hasFilters && (
          <button
            type="button"
            className="link"
            onClick={() => {
              setSearch("");
              onQuery({ q: undefined, status: undefined, service: undefined, driverId: undefined, lateOnly: undefined, page: 1 });
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} aria-sort={query.sort === c.key ? (query.dir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" onClick={() => sortBy(c.key)}>
                    {c.label}
                    <span className="sort-mark" aria-hidden="true">{query.sort === c.key ? (query.dir === "asc" ? "▲" : "▼") : ""}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page?.items.map((job) => (
              <tr key={job.id} className={changed.has(job.id) ? "row-changed" : undefined} onClick={() => onOpen(job.id)}>
                <td className="mono">
                  <button type="button" className="job-link" onClick={(e) => { e.stopPropagation(); onOpen(job.id); }}>{job.number}</button>
                </td>
                <td>{job.customer}</td>
                <td className="route">{job.pickupSuburb} <span aria-label="to">&rarr;</span> {job.deliverySuburb}</td>
                <td>{SERVICE_LABEL[job.service]}</td>
                <td className={job.driver ? undefined : "muted"}>{job.driver ?? "Nobody yet"}</td>
                <td className="mono">{formatTime(job.dueAt)}{job.isLate && <span className="late-tag">LATE</span>}</td>
                <td><span className={`status status-${job.status}`}>{STATUS_LABEL[job.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {page?.items.length === 0 && <p className="empty">No jobs match these filters.</p>}
      </div>

      <div className="pager">
        <span>{page ? `${page.total} ${page.total === 1 ? "job" : "jobs"}` : "Loading"}</span>
        <div>
          <button type="button" disabled={query.page <= 1} onClick={() => onQuery({ page: query.page - 1 })}>Previous</button>
          <span className="page-of">Page {query.page} of {lastPage}</span>
          <button type="button" disabled={query.page >= lastPage} onClick={() => onQuery({ page: query.page + 1 })}>Next</button>
        </div>
      </div>
    </section>
  );
}
