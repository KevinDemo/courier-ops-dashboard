import { useState } from "react";
import { formatHour } from "../format";
import type { HourBucket } from "../types";

// Colours validated against the #13232a surface with the dataviz palette checker. Order is fixed, never by rank.
const SERIES = [
  { key: "onTime", label: "On time", color: "#2aa691" },
  { key: "late", label: "Late", color: "#e4630c" },
  { key: "open", label: "In progress", color: "#748edf" },
  { key: "failed", label: "Failed", color: "#d45fa0" },
] as const;

const WIDTH = 380;
const HEIGHT = 190;
const LEFT = 26;
const RIGHT = 4;
const TOP = 14;
const BOTTOM = 20;
const GAP = 2;

const total = (b: HourBucket) => b.onTime + b.late + b.open + b.failed;

function niceMax(value: number): number {
  for (const step of [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200]) if (value <= step) return step;
  return Math.ceil(value / 100) * 100;
}

// Only the top of a stack gets the rounded corners. It stays square on the baseline.
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + w - radius}Q${x + w},${y} ${x + w},${y + radius}V${y + h}Z`;
}

export function HourlyChart({ hours }: { hours: HourBucket[] }) {
  const [active, setActive] = useState<number | null>(null);

  if (hours.length === 0) return <p className="empty">No jobs to chart yet.</p>;

  const peak = Math.max(...hours.map(total));
  const max = niceMax(peak);
  const plotH = HEIGHT - TOP - BOTTOM;
  const step = (WIDTH - LEFT - RIGHT) / hours.length;
  const barW = Math.max(step - 3, 3);
  const y = (value: number) => TOP + plotH - (value / max) * plotH;
  const peakIndex = hours.findIndex((b) => total(b) === peak);
  const totals = SERIES.map((s) => hours.reduce((sum, b) => sum + b[s.key], 0));
  const shown = active === null ? null : hours[active];

  return (
    <div className="chart">
      <ul className="legend">
        {SERIES.map((s, i) => (
          <li key={s.key}>
            <span className="swatch" style={{ background: s.color }} aria-hidden="true" />
            {s.label} <b>{totals[i]}</b>
          </li>
        ))}
      </ul>

      <div className="chart-plot" onMouseLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Jobs by ready hour. Busiest hour is ${formatHour(hours[peakIndex].hour)} with ${peak} jobs.`}>
          {[0, max / 2, max].map((tick) => (
            <g key={tick}>
              <line x1={LEFT} x2={WIDTH - RIGHT} y1={y(tick)} y2={y(tick)} className={tick === 0 ? "axis" : "grid"} />
              <text x={LEFT - 5} y={y(tick) + 3} textAnchor="end" className="tick">{tick}</text>
            </g>
          ))}

          {hours.map((bucket, i) => {
            const x = LEFT + i * step + (step - barW) / 2;
            let cursor = 0;
            const present = SERIES.filter((s) => bucket[s.key] > 0);
            return (
              <g key={bucket.hour} className={active !== null && active !== i ? "dim" : undefined}>
                {present.map((s, index) => {
                  const start = cursor;
                  cursor += bucket[s.key];
                  const top = y(cursor);
                  // A 2px surface gap separates stacked segments.
                  const height = Math.max(y(start) - top - (index === 0 ? 0 : GAP), 1);
                  return index === present.length - 1
                    ? <path key={s.key} data-series={s.key} d={roundedTop(x, top, barW, height, 4)} fill={s.color} />
                    : <rect key={s.key} data-series={s.key} x={x} y={top} width={barW} height={height} fill={s.color} />;
                })}
                {i % 2 === 0 && <text x={x + barW / 2} y={HEIGHT - 6} textAnchor="middle" className="tick">{String(bucket.hour).padStart(2, "0")}</text>}
                {i === peakIndex && <text x={x + barW / 2} y={y(peak) - 4} textAnchor="middle" className="peak">{peak}</text>}
                {/* The whole column is the hover target, wider and taller than the marks in it. */}
                <rect
                  x={LEFT + i * step}
                  y={TOP}
                  width={step}
                  height={plotH + BOTTOM}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${formatHour(bucket.hour)}: ${total(bucket)} jobs`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            );
          })}
        </svg>

        {shown && active !== null && (
          <div className="tooltip" role="status" style={{ left: `${((LEFT + (active + 0.5) * step) / WIDTH) * 100}%` }}>
            <strong>{formatHour(shown.hour)}</strong> {total(shown)} jobs
            {SERIES.map((s) => (
              <div key={s.key} className="tooltip-row">
                <span className="swatch" style={{ background: s.color }} aria-hidden="true" />
                {s.label} <b>{shown[s.key]}</b>
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="chart-table">
        <summary>View as table</summary>
        <table>
          <thead>
            <tr><th>Hour</th>{SERIES.map((s) => <th key={s.key}>{s.label}</th>)}</tr>
          </thead>
          <tbody>
            {hours.map((b) => (
              <tr key={b.hour}><td>{formatHour(b.hour)}</td>{SERIES.map((s) => <td key={s.key}>{b[s.key]}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
