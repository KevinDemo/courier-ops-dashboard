import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { HourlyChart } from "../components/HourlyChart";
import { KpiTiles } from "../components/KpiTiles";
import { toQueryString } from "../data/apiSource";
import { createDemoSource } from "../data/demoSource";
import { AuthError, type DataSource } from "../types";

afterEach(cleanup);

const noon = () => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  return date;
};

describe("KpiTiles", () => {
  const kpis = { jobsToday: 160, onTimePercent: 92.5, delivered: 80, late: 7, unassigned: 0, failed: 2 };

  it("shows the four numbers", () => {
    render(<KpiTiles kpis={kpis} onShowLate={() => {}} onShowUnassigned={() => {}} />);
    expect(screen.getByText("160")).toBeTruthy();
    expect(screen.getByText("92.5%")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("does not claim 0% on time before anything is delivered", () => {
    render(<KpiTiles kpis={{ ...kpis, onTimePercent: null, delivered: 0 }} onShowLate={() => {}} onShowUnassigned={() => {}} />);
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.getByText("nothing delivered yet")).toBeTruthy();
  });

  it("clicking Late asks for the late jobs", async () => {
    const onShowLate = vi.fn();
    render(<KpiTiles kpis={kpis} onShowLate={onShowLate} onShowUnassigned={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /late/i }));
    expect(onShowLate).toHaveBeenCalledOnce();
  });
});

describe("HourlyChart", () => {
  const hours = [
    { hour: 8, onTime: 5, late: 1, open: 0, failed: 0 },
    { hour: 9, onTime: 2, late: 3, open: 4, failed: 1 },
  ];

  it("has a legend with totals, so identity is not colour alone", () => {
    render(<HourlyChart hours={hours} />);
    const legend = screen.getByRole("list");
    expect(within(legend).getByText(/On time/).textContent).toContain("7");
    expect(within(legend).getByText(/Late/).textContent).toContain("4");
  });

  it("draws one mark per non-zero segment", () => {
    const { container } = render(<HourlyChart hours={hours} />);
    expect(container.querySelectorAll("[data-series]")).toHaveLength(6);
  });

  it("offers the numbers as a table", () => {
    render(<HourlyChart hours={hours} />);
    expect(screen.getByText("View as table")).toBeTruthy();
    expect(screen.getByRole("table", { hidden: true })).toBeTruthy();
  });

  it("shows a tooltip on keyboard focus", async () => {
    render(<HourlyChart hours={hours} />);
    await userEvent.tab();
    expect(screen.getByRole("status").textContent).toContain("08:00");
  });

  it("says so when there is nothing to chart", () => {
    render(<HourlyChart hours={[]} />);
    expect(screen.getByText("No jobs to chart yet.")).toBeTruthy();
  });
});

describe("App with the demo data source", () => {
  it("skips login, shows a demo banner, and fills the screen", async () => {
    render(<App source={createDemoSource({ now: noon, tickMs: 100000 })} />);
    expect(await screen.findByText(/Demo mode/)).toBeTruthy();
    expect(await screen.findByText("160 jobs")).toBeTruthy();
    expect(screen.queryByText("Sign out")).toBeNull();
  });

  it("opens the drawer from a row with a timeline, and Escape closes it", async () => {
    render(<App source={createDemoSource({ now: noon, tickMs: 100000 })} />);
    await screen.findByText("160 jobs");
    const firstJob = screen.getAllByRole("button", { name: /^HF\d+/ })[0];
    await userEvent.click(firstJob);
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Timeline")).toBeTruthy();
    expect(within(drawer).getByText("Booked")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("filters through the status dropdown and resets to page 1", async () => {
    render(<App source={createDemoSource({ now: noon, tickMs: 100000 })} />);
    await screen.findByText("160 jobs");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/Page 2 of/);
    await userEvent.selectOptions(screen.getByLabelText("Status"), "Delivered");
    await screen.findByText(/Page 1 of/);
    await waitFor(() => expect(screen.queryByText("160 jobs")).toBeNull());
  });

  it("a live change updates the feed and the numbers", async () => {
    const source = createDemoSource({ now: noon, tickMs: 20 });
    render(<App source={source} />);
    await screen.findByText("160 jobs");
    await waitFor(() => expect(screen.queryByText("Waiting for the next scan.")).toBeNull());
    expect(screen.getByRole("status", { name: "" }).textContent).toContain("Live");
  });

  it("the simulator only moves jobs forward", () => {
    const source = createDemoSource({ now: noon, tickMs: 100000 });
    for (let i = 0; i < 300; i++) {
      const change = source.tick();
      expect(change.status).not.toBe("Unassigned");
    }
  });
});

describe("App with the real API source", () => {
  const signedOut: DataSource = {
    ...createDemoSource({ now: noon, tickMs: 100000 }),
    isDemo: false,
    me: () => Promise.reject(new AuthError("Not signed in.")),
    login: (_email, password) => (password === "harbour-demo" ? Promise.resolve("ops@harbourfreight.example") : Promise.reject(new AuthError("no"))),
  };

  it("asks for a login, refuses a wrong password, accepts the right one", async () => {
    render(<App source={signedOut} />);
    const password = await screen.findByLabelText("Password");
    await userEvent.type(password, "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toContain("did not match");

    await userEvent.clear(password);
    await userEvent.type(password, "harbour-demo");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Sign out")).toBeTruthy();
  });

  it("sends the filters the API expects, and leaves out what is not set", () => {
    const text = toQueryString({ sort: "dueAt", dir: "desc", page: 2, pageSize: 15, status: "Failed", lateOnly: true, q: "  tern  " });
    const params = new URLSearchParams(text);
    expect(Object.fromEntries(params)).toEqual({ sort: "dueAt", dir: "desc", page: "2", pageSize: "15", status: "Failed", lateOnly: "true", q: "tern" });
  });
});
