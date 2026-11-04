import type { JobStatus, ServiceLevel } from "./types";

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

export const formatTime = (iso: string) => clock.format(new Date(iso));

export const formatHour = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

export const STATUS_LABEL: Record<JobStatus, string> = {
  Unassigned: "Unassigned",
  Assigned: "Assigned",
  PickedUp: "Picked up",
  InTransit: "In transit",
  Delivered: "Delivered",
  Failed: "Failed",
};

// A shape as well as a colour, so status never depends on colour alone.
export const STATUS_GLYPH: Record<JobStatus, string> = {
  Unassigned: "○",
  Assigned: "◔",
  PickedUp: "◑",
  InTransit: "◕",
  Delivered: "●",
  Failed: "✕",
};

export const SERVICE_LABEL: Record<ServiceLevel, string> = {
  Standard: "Standard",
  Express: "Express",
  SameDay: "Same day",
};
