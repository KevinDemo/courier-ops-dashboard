import { useCallback, useEffect, useRef, useState } from "react";
import { HourlyChart } from "./components/HourlyChart";
import { JobDrawer } from "./components/JobDrawer";
import { JobsTable } from "./components/JobsTable";
import { KpiTiles } from "./components/KpiTiles";
import { Login } from "./components/Login";
import { STATUS_GLYPH, STATUS_LABEL, formatTime } from "./format";
import { AuthError, type Connection, type DataSource, type Driver, type HourBucket, type JobChanged, type JobDetail, type JobQuery, type Kpis, type PagedJobs } from "./types";

const FIRST_QUERY: JobQuery = { sort: "dueAt", dir: "asc", page: 1, pageSize: 15 };
const CONNECTION_LABEL: Record<Connection, string> = { live: "Live", reconnecting: "Reconnecting", offline: "Offline" };
const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });

function Dashboard({ source, user, onSignOut }: { source: DataSource; user: string; onSignOut: () => void }) {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [hours, setHours] = useState<HourBucket[]>([]);
  const [page, setPage] = useState<PagedJobs | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [query, setQuery] = useState(FIRST_QUERY);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [feed, setFeed] = useState<JobChanged[]>([]);
  const [changed, setChanged] = useState<ReadonlySet<number>>(new Set());
  const [connection, setConnection] = useState<Connection>("reconnecting");
  const [error, setError] = useState("");

  const queryRef = useRef(query);
  queryRef.current = query;
  const openRef = useRef(openId);
  openRef.current = openId;
  const requestNumber = useRef(0);

  const fail = useCallback((reason: unknown) => {
    if (reason instanceof AuthError) onSignOut();
    else setError("Could not refresh just now. The numbers shown may be out of date.");
  }, [onSignOut]);

  const loadJobs = useCallback(async () => {
    // Replies can arrive out of order, and only the newest request may draw the table.
    const number = ++requestNumber.current;
    const result = await source.getJobs(queryRef.current);
    if (number === requestNumber.current) setPage(result);
  }, [source]);

  const refresh = useCallback(async () => {
    try {
      const [nextKpis, nextHours] = await Promise.all([source.getKpis(), source.getHourly(), loadJobs()]);
      setKpis(nextKpis);
      setHours(nextHours);
      if (openRef.current !== null) setDetail(await source.getJob(openRef.current));
      setError("");
    } catch (reason) {
      fail(reason);
    }
  }, [source, loadJobs, fail]);

  useEffect(() => { loadJobs().catch(fail); }, [query, loadJobs, fail]);

  useEffect(() => {
    if (openId === null) {
      setDetail(null);
      return;
    }
    source.getJob(openId).then(setDetail).catch(fail);
  }, [openId, source, fail]);

  useEffect(() => {
    void refresh();
    source.getDrivers().then(setDrivers).catch(fail);

    let debounce: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = source.subscribe((change) => {
      setFeed((items) => [change, ...items].slice(0, 12));
      setChanged((ids) => new Set(ids).add(change.id));
      setTimeout(() => setChanged((ids) => {
        const next = new Set(ids);
        next.delete(change.id);
        return next;
      }), 1800);
      // Changes can come in bursts, and one refresh covers them all.
      clearTimeout(debounce);
      debounce = setTimeout(() => void refresh(), 300);
    }, setConnection);

    return () => {
      clearTimeout(debounce);
      unsubscribe();
    };
  }, [source, refresh, fail]);

  const patchQuery = useCallback((patch: Partial<JobQuery>) => setQuery((q) => ({ ...q, ...patch })), []);
  const closeDrawer = useCallback(() => setOpenId(null), []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="wordmark">Harbour Ops</span>
          <span className="today">{dateLabel.format(new Date())}</span>
        </div>
        <div className="topbar-right">
          <span className={`connection connection-${connection}`} role="status"><span className="dot" aria-hidden="true" />{CONNECTION_LABEL[connection]}</span>
          {!source.isDemo && <span className="user">{user}</span>}
          {!source.isDemo && <button type="button" className="link" onClick={onSignOut}>Sign out</button>}
        </div>
      </header>
      <div className="hazard" aria-hidden="true" />

      {source.isDemo && (
        <p className="demo-banner">Demo mode: fictional data generated in your browser, with a simulator moving jobs along. No server is involved.</p>
      )}
      {error && <p className="error-banner" role="alert">{error}</p>}

      <KpiTiles
        kpis={kpis}
        onShowLate={() => patchQuery({ lateOnly: true, status: undefined, page: 1 })}
        onShowUnassigned={() => patchQuery({ status: "Unassigned", lateOnly: undefined, page: 1 })}
      />

      <main className="board">
        <JobsTable page={page} query={query} drivers={drivers} changed={changed} onQuery={patchQuery} onOpen={setOpenId} />

        <div className="rail">
          <section className="panel">
            <h2>Jobs by ready hour</h2>
            <HourlyChart hours={hours} />
          </section>
          <section className="panel feed">
            <h2>Just now</h2>
            {feed.length === 0 && <p className="empty">Waiting for the next scan.</p>}
            <ol>
              {feed.map((item, index) => (
                <li key={`${item.id}-${item.at}-${index}`}>
                  <button type="button" onClick={() => setOpenId(item.id)}>
                    <span className="mono">{formatTime(item.at)}</span>
                    <span className="feed-text"><b>{item.number}</b> {item.customer}</span>
                    <span className={`status status-${item.status}`}><span aria-hidden="true">{STATUS_GLYPH[item.status]}</span> {STATUS_LABEL[item.status]}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </main>

      {detail && <JobDrawer detail={detail} onClose={closeDrawer} />}
    </div>
  );
}

export function App({ source }: { source: DataSource }) {
  const [user, setUser] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    source.me().then(setUser).catch(() => setUser(null)).finally(() => setChecked(true));
  }, [source]);

  const signOut = useCallback(() => {
    setUser(null);
    source.logout().catch(() => {});
  }, [source]);

  if (!checked) return null;
  if (!user) return <Login onLogin={async (email, password) => setUser(await source.login(email, password))} />;
  return <Dashboard source={source} user={user} onSignOut={signOut} />;
}
