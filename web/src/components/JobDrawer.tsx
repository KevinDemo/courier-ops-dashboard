import { useEffect, useRef } from "react";
import { SERVICE_LABEL, STATUS_GLYPH, STATUS_LABEL, formatTime } from "../format";
import type { JobDetail } from "../types";

export function JobDrawer({ detail, onClose }: { detail: JobDetail; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  const { job } = detail;
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Job ${job.number}`} onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow mono">{job.number}</p>
            <h2>{job.customer}</h2>
          </div>
          <button type="button" ref={closeButton} className="close" onClick={onClose} aria-label="Close job details">&times;</button>
        </header>

        <p className="drawer-status">
          <span className={`status status-${job.status}`}><span aria-hidden="true">{STATUS_GLYPH[job.status]}</span> {STATUS_LABEL[job.status]}</span>
          {job.isLate && <span className="late-tag">LATE</span>}
        </p>

        <dl className="facts">
          <div><dt>Pickup</dt><dd>{job.pickupSuburb}</dd></div>
          <div><dt>Delivery</dt><dd>{job.deliverySuburb}</dd></div>
          <div><dt>Service</dt><dd>{SERVICE_LABEL[job.service]}</dd></div>
          <div><dt>Freight</dt><dd>{detail.pieces} pcs, {detail.weightKg} kg</dd></div>
          <div><dt>Ready</dt><dd className="mono">{formatTime(job.readyAt)}</dd></div>
          <div><dt>Due</dt><dd className="mono">{formatTime(job.dueAt)}</dd></div>
          <div><dt>Driver</dt><dd>{job.driver ?? "Nobody yet"}</dd></div>
          <div><dt>Vehicle</dt><dd>{detail.vehicle ?? "None"}</dd></div>
        </dl>

        <h3>Timeline</h3>
        <ol className="timeline">
          {detail.events.map((event, index) => (
            <li key={index}>
              <span className="mono">{formatTime(event.at)}</span>
              <span>{event.note}</span>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
