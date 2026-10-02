import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, expect, test } from "vitest";
import { startServer } from "../src/server.ts";
import { configPath, connectedDisplay } from "./helpers.ts";

let running: { port: number; close: () => Promise<void> } | undefined;
const upstreams: Server[] = [];
const originalToken = process.env.POSTHOG_PERSONAL_API_KEY;

beforeEach(() => {
  process.env.POSTHOG_PERSONAL_API_KEY = "test-posthog-token";
});

afterEach(async () => {
  await running?.close();
  running = undefined;
  await Promise.all(
    upstreams.splice(0).map((server) => {
      server.closeAllConnections();
      return new Promise<void>((done) => server.close(() => done()));
    }),
  );
  if (originalToken === undefined) delete process.env.POSTHOG_PERSONAL_API_KEY;
  else process.env.POSTHOG_PERSONAL_API_KEY = originalToken;
});

async function upstream(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  upstreams.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const tile = (id: number, result: unknown[]) => ({ id, insight: { result } });
// The saved insight labels rows by weekday of the Sat–Fri cycle and carries a
// daily-target column the board does not use.
const DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const dashboard = (targetPercent = "33.7%") => ({
  results: [
    tile(7119738, [[5906]]),
    tile(7119740, [[17518]]),
    tile(7122309, [[targetPercent]]),
    tile(10992630, [["4.5%"]]),
    tile(
      7119735,
      DAYS.map((label, day) => [label, 1000 + day, 900 + day, 2503]),
    ),
  ],
});

test("the WAU route answers from PostHog's cache and refreshes it in the background", async () => {
  const requests: { url?: string; authorization?: string; accept?: string }[] = [];
  const base = await upstream((req, res) => {
    requests.push({
      url: req.url,
      authorization: req.headers.authorization,
      accept: req.headers.accept,
    });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(dashboard()));
  });
  running = await startServer(0, { configPath, posthogApiBase: base });

  const response = await fetch(`http://127.0.0.1:${running.port}/wau.json`);
  const body = await response.json();
  while (requests.length < 2) await sleep(5);

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const urls = requests.map((request) => new URL(request.url!, base));
  expect(urls.map((url) => url.searchParams.get("refresh")).sort()).toEqual([
    "blocking",
    "force_cache",
  ]);
  for (const [index, url] of urls.entries()) {
    expect(requests[index].authorization).toBe("Bearer test-posthog-token");
    expect(requests[index].accept).toBe("application/json");
    expect(url.pathname).toBe("/api/projects/196853/dashboards/1468050/run_insights/");
    expect(url.searchParams.get("tile_ids")).toBe(
      "7119738,7119740,7122309,10992630,7119735",
    );
    expect(url.searchParams.get("output_format")).toBe("json");
  }
  expect(body).toEqual({
    fetchedAt: expect.any(String),
    currentWau: 5906,
    targetWau: 17518,
    targetPercent: 33.7,
    activationPercent: 4.5,
    daily: DAYS.map((label, day) => ({
      day: day + 1,
      label,
      current: 1000 + day,
      previous: 900 + day,
    })),
  });
  expect(JSON.stringify(body)).not.toContain("test-posthog-token");
});

test("a slow PostHog recompute does not hold up the WAU route", async () => {
  const base = await upstream((req, res) => {
    // The background refresh never answers; the cached read does.
    if (new URL(req.url!, "http://x").searchParams.get("refresh") === "blocking") return;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(dashboard()));
  });
  running = await startServer(0, { configPath, posthogApiBase: base, posthogTimeoutMs: 1000 });

  expect((await fetch(`http://127.0.0.1:${running.port}/wau.json`)).status).toBe(200);
});

test("only one PostHog recompute runs at a time", async () => {
  let warms = 0;
  const base = await upstream((req, res) => {
    if (new URL(req.url!, "http://x").searchParams.get("refresh") === "blocking") {
      warms += 1;
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(dashboard()));
  });
  running = await startServer(0, { configPath, posthogApiBase: base });

  await fetch(`http://127.0.0.1:${running.port}/wau.json`);
  await fetch(`http://127.0.0.1:${running.port}/wau.json`);
  await sleep(50);

  expect(warms).toBe(1);
});

test.each([
  ["an upstream error", (res: import("node:http").ServerResponse) => res.writeHead(500).end()],
  [
    "a missing tile",
    (res: import("node:http").ServerResponse) =>
      res.end(JSON.stringify({ results: dashboard().results.slice(0, 1) })),
  ],
])("the WAU route keeps the last good numbers through %s", async (_name, fail) => {
  let broken = false;
  const base = await upstream((req, res) => {
    if (new URL(req.url!, "http://x").searchParams.get("refresh") === "blocking") return;
    res.setHeader("content-type", "application/json");
    if (broken) fail(res);
    else res.end(JSON.stringify(dashboard()));
  });
  running = await startServer(0, { configPath, posthogApiBase: base });

  const good = await (await fetch(`http://127.0.0.1:${running.port}/wau.json`)).json();
  broken = true;
  const after = await fetch(`http://127.0.0.1:${running.port}/wau.json`);

  expect(after.status).toBe(200);
  expect(await after.json()).toEqual(good);
});

test("the WAU route is unavailable without a PostHog credential", async () => {
  delete process.env.POSTHOG_PERSONAL_API_KEY;
  running = await startServer(0, { configPath });

  expect((await fetch(`http://127.0.0.1:${running.port}/wau.json`)).status).toBe(503);
});

test("the WAU route maps an upstream error to 502", async () => {
  const base = await upstream((_req, res) => {
    res.writeHead(503);
    res.end("no");
  });
  running = await startServer(0, { configPath, posthogApiBase: base });

  expect((await fetch(`http://127.0.0.1:${running.port}/wau.json`)).status).toBe(502);
});

test("the WAU route times out a stalled upstream", async () => {
  const base = await upstream(async (_req, res) => {
    await sleep(100);
    res.end(JSON.stringify(dashboard()));
  });
  running = await startServer(0, {
    configPath,
    posthogApiBase: base,
    posthogTimeoutMs: 10,
  });

  expect((await fetch(`http://127.0.0.1:${running.port}/wau.json`)).status).toBe(502);
});

test("the WAU route rejects an oversized upstream response", async () => {
  const base = await upstream((_req, res) => res.end("x".repeat(1024 * 1024 + 1)));
  running = await startServer(0, { configPath, posthogApiBase: base });

  expect((await fetch(`http://127.0.0.1:${running.port}/wau.json`)).status).toBe(502);
});

test.each([
  ["malformed", { results: "nope" }],
  [
    "non-numeric daily",
    {
      results: dashboard().results.map((item) =>
        item.id === 7119735 ? tile(7119735, [["Saturday", "n/a", 1, 2503]]) : item,
      ),
    },
  ],
  ["missing a required tile", { results: dashboard().results.slice(1) }],
  [
    "missing a daily result",
    {
      results: dashboard().results.map((item) =>
        item.id === 7119735 ? tile(7119735, item.insight.result.slice(0, 6)) : item,
      ),
    },
  ],
])("the WAU route rejects %s PostHog data", async (_name, body) => {
  const base = await upstream((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  });
  running = await startServer(0, { configPath, posthogApiBase: base });

  expect((await fetch(`http://127.0.0.1:${running.port}/wau.json`)).status).toBe(502);
});

/** Quiet Hours are local time: 13 August 2026 is a Thursday. */
const thursdayAt = (hour: number) => new Date(2026, 7, 13, hour).getTime();

/** Serve each PostHog read the next target percent, and collect what the board hears. */
async function targetHits(percents: string[], clock = thursdayAt(10)) {
  const base = await upstream((req, res) => {
    if (new URL(req.url!, "http://x").searchParams.get("refresh") === "blocking") return;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(dashboard(percents.shift())));
  });
  running = await startServer(0, { configPath, posthogApiBase: base, now: () => clock });
  const { ws, messages } = await connectedDisplay(running.port);
  while (percents.length) await fetch(`http://127.0.0.1:${running.port}/wau.json`);
  await sleep(50);
  ws.close();
  return messages.filter((message) => message.type === "wau-target-hit");
}

test("the WAU target crossing 100% is broadcast as a Target Hit", async () => {
  expect(await targetHits(["95%", "100%"])).toEqual([
    {
      type: "wau-target-hit",
      audible: true,
      currentWau: 5906,
      targetWau: 17518,
      targetPercent: 100,
    },
  ]);
});

test("a first read already over target is no crossing", async () => {
  expect(await targetHits(["100%", "100%"])).toEqual([]);
});

test("staying over target celebrates only the one crossing", async () => {
  expect(await targetHits(["99.9%", "100%", "100%", "101%"])).toHaveLength(1);
});

test("a Target Hit in Quiet Hours is flagged silent", async () => {
  expect(await targetHits(["95%", "100%"], thursdayAt(22))).toMatchObject([
    { type: "wau-target-hit", audible: false },
  ]);
});

test("a slow read of older cache landing after the crossing does not re-arm it", async () => {
  // Read 2 asks first but answers last, with the cache from before the crossing.
  const reads: [string, number][] = [["95%", 0], ["99%", 200], ["100%", 0], ["100%", 0]];
  const base = await upstream((req, res) => {
    if (new URL(req.url!, "http://x").searchParams.get("refresh") === "blocking") return;
    const [percent, delay] = reads.shift()!;
    setTimeout(() => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(dashboard(percent)));
    }, delay);
  });
  running = await startServer(0, { configPath, posthogApiBase: base, now: () => thursdayAt(10) });
  const { ws, messages } = await connectedDisplay(running.port);
  const wau = () => fetch(`http://127.0.0.1:${running!.port}/wau.json`);
  await wau();
  const slow = wau();
  await sleep(50);
  await wau();
  await slow;
  await wau();
  await sleep(50);
  ws.close();
  expect(messages.filter((message) => message.type === "wau-target-hit")).toHaveLength(1);
});

test("a loopback POST replays the Target Hit", async () => {
  running = await startServer(0, { configPath, now: () => thursdayAt(10) });
  const { ws, messages } = await connectedDisplay(running.port);
  const response = await fetch(`http://127.0.0.1:${running.port}/wau-target-hit`, {
    method: "POST",
  });
  await sleep(50);
  ws.close();
  expect(response.status).toBe(204);
  expect(messages.filter((message) => message.type === "wau-target-hit")).toEqual([
    { type: "wau-target-hit", audible: true },
  ]);
});

test("a proxied POST (Funnel adds X-Forwarded-For) cannot replay the Target Hit", async () => {
  running = await startServer(0, { configPath, now: () => thursdayAt(10) });
  const { ws, messages } = await connectedDisplay(running.port);
  const response = await fetch(`http://127.0.0.1:${running.port}/wau-target-hit`, {
    method: "POST",
    headers: { "x-forwarded-for": "1.2.3.4" },
  });
  await sleep(50);
  ws.close();
  expect(response.status).toBe(403);
  expect(messages.filter((message) => message.type === "wau-target-hit")).toEqual([]);
});

test("a display connecting after a Target Hit is told the board wears the Arcade Theme", async () => {
  running = await startServer(0, { configPath, now: () => thursdayAt(10) });
  const before = await connectedDisplay(running.port);
  await fetch(`http://127.0.0.1:${running.port}/wau-target-hit`, { method: "POST" });
  const after = await connectedDisplay(running.port);
  await sleep(50);
  before.ws.close();
  after.ws.close();
  expect(before.messages[0]).toMatchObject({ type: "snapshot", theme: "kernel" });
  expect(after.messages[0]).toMatchObject({ type: "snapshot", theme: "arcade" });
});

test("a PostHog crossing also puts the board in the Arcade Theme", async () => {
  await targetHits(["95%", "100%"]);
  const { ws, messages } = await connectedDisplay(running!.port);
  await sleep(50);
  ws.close();
  expect(messages[0]).toMatchObject({ type: "snapshot", theme: "arcade" });
});

test("the Arcade Theme ends at local midnight with one fresh snapshot", async () => {
  let clock = new Date(2026, 7, 13, 23, 30).getTime(); // Thursday, late
  running = await startServer(0, { configPath, now: () => clock, tickMs: 10 });
  await fetch(`http://127.0.0.1:${running.port}/wau-target-hit`, { method: "POST" });
  const { ws, messages } = await connectedDisplay(running.port);
  await sleep(50);
  clock = new Date(2026, 7, 14, 0, 0, 30).getTime(); // just past midnight
  await sleep(100);
  ws.close();
  const snapshots = messages.filter((message) => message.type === "snapshot");
  expect(snapshots.map((snapshot) => snapshot.theme)).toEqual(["arcade", "kernel"]);
});
