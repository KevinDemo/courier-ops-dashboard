import { describe, expect, it } from "vitest";
import fixture from "../../../tests-shared/kpi-fixture.json";
import { computeKpis, isLate, queryJobs, type RuleJob } from "../data/rules";
import { generateJobs } from "../data/demoSource";
import type { JobQuery } from "../types";

const now = new Date(fixture.nowUtc);
const jobs = fixture.jobs as unknown as (RuleJob & { number: string })[];
const baseQuery: JobQuery = { sort: "dueAt", dir: "asc", page: 1, pageSize: 25 };

describe("shared KPI fixture", () => {
  it("gives the same answers as the server, so demo mode cannot drift from the API", () => {
    expect(computeKpis(jobs, now, new Date(fixture.todayStartUtc), new Date(fixture.todayEndUtc))).toEqual(fixture.expected);
  });

  it.each([
    ["T1", false],
    ["T2", false],
    ["T3", true],
    ["T4", true],
    ["T5", false],
    ["T6", true],
    ["T7", false],
    ["T8", false],
  ])("%s late = %s", (prefix, expected) => {
    const job = jobs.find((j) => j.number.startsWith(prefix))!;
    expect(isLate(job, now)).toBe(expected);
  });
});

describe("queryJobs", () => {
  const rows = generateJobs(new Date("2026-11-04T04:00:00Z"));

  it("pages through every job exactly once", () => {
    const seen: string[] = [];
    for (let page = 1; page <= 7; page++) seen.push(...queryJobs(rows, { ...baseQuery, page }).items.map((j) => j.number));
    expect(seen).toHaveLength(rows.length);
    expect(new Set(seen).size).toBe(rows.length);
  });

  it("sorts in both directions and breaks ties by id", () => {
    const ascending = queryJobs(rows, { ...baseQuery, sort: "customer", pageSize: 200 }).items;
    const descending = queryJobs(rows, { ...baseQuery, sort: "customer", dir: "desc", pageSize: 200 }).items;
    expect(ascending.map((j) => j.customer)).toEqual([...ascending.map((j) => j.customer)].sort());
    expect(descending[0].customer >= descending[descending.length - 1].customer).toBe(true);
    for (let i = 1; i < ascending.length; i++) {
      if (ascending[i].customer === ascending[i - 1].customer) expect(ascending[i].id).toBeGreaterThan(ascending[i - 1].id);
    }
  });

  it("sorts status by workflow, not alphabetically", () => {
    const statuses = queryJobs(rows, { ...baseQuery, sort: "status", pageSize: 200 }).items.map((j) => j.status);
    expect(statuses.indexOf("Unassigned")).toBeLessThan(statuses.indexOf("Delivered"));
  });

  it("combines filters and reports the filtered total", () => {
    const result = queryJobs(rows, { ...baseQuery, status: "Delivered", service: "Express", pageSize: 200 });
    expect(result.total).toBe(rows.filter((j) => j.status === "Delivered" && j.service === "Express").length);
    expect(result.total).toBeGreaterThan(0);
    expect(result.total).toBeLessThan(rows.length);
  });

  it("searches any case across number, customer and suburb", () => {
    expect(queryJobs(rows, { ...baseQuery, q: "BELLBIRD" }).items.every((j) => j.customer === "Bellbird Ceramics" )).toBe(true);
    expect(queryJobs(rows, { ...baseQuery, q: rows[0].number.toLowerCase() }).total).toBe(1);
  });
});

describe("generateJobs", () => {
  it("gives the same day for the same date and clock", () => {
    const at = new Date("2026-11-04T04:00:00Z");
    expect(generateJobs(at)).toEqual(generateJobs(at));
  });

  it("never records a timeline event after the current time", () => {
    const at = new Date("2026-11-04T04:00:00Z");
    for (const job of generateJobs(at)) {
      for (const event of job.events) expect(new Date(event.at).getTime()).toBeLessThanOrEqual(at.getTime());
    }
  });
});
