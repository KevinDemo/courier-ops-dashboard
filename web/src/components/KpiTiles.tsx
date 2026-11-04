import type { Kpis } from "../types";

interface TileProps {
  label: string;
  value: string;
  detail: string;
  alert?: boolean;
  onClick?: () => void;
}

function Tile({ label, value, detail, alert, onClick }: TileProps) {
  const body = (
    <>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      <span className="tile-detail">{detail}</span>
    </>
  );
  const className = `tile${alert ? " tile-alert" : ""}`;
  return onClick ? (
    <button type="button" className={className} onClick={onClick} title={`Show ${label.toLowerCase()} jobs`}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function KpiTiles({ kpis, onShowLate, onShowUnassigned }: { kpis: Kpis | null; onShowLate: () => void; onShowUnassigned: () => void }) {
  const dash = "--";
  return (
    <section className="tiles" aria-label="Today at a glance">
      <Tile label="Jobs today" value={kpis ? String(kpis.jobsToday) : dash} detail={kpis ? `${kpis.delivered} delivered, ${kpis.failed} failed` : ""} />
      <Tile
        label="On time"
        value={kpis?.onTimePercent != null ? `${kpis.onTimePercent}%` : dash}
        detail={kpis?.delivered ? `of ${kpis.delivered} delivered` : "nothing delivered yet"}
      />
      <Tile label="Late" value={kpis ? String(kpis.late) : dash} detail="delivered late or overdue" alert={(kpis?.late ?? 0) > 0} onClick={onShowLate} />
      <Tile label="Unassigned" value={kpis ? String(kpis.unassigned) : dash} detail="waiting for a driver" alert={(kpis?.unassigned ?? 0) > 0} onClick={onShowUnassigned} />
    </section>
  );
}
