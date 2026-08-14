import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, expect, test } from "vitest";
import { startServer } from "../src/server.ts";
import {
  badConfigPath,
  configPath,
  connectedDisplay,
  fixture,
  postWebhook,
  readSnapshot,
} from "./helpers.ts";

const merged = fixture("pull-request-merged.json");
const review = fixture("pull-request-review.json");
const comment = fixture("issue-comment.json");
const opened = JSON.stringify({
  ...JSON.parse(merged),
  action: "opened",
  pull_request: { ...JSON.parse(merged).pull_request, merged: false },
});
const changesRequested = JSON.stringify({
  ...JSON.parse(review),
  review: { state: "changes_requested" },
});

const start = (now?: () => number) => startServer(0, { configPath, now });

let running: { port: number; close: () => Promise<void> } | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

test("a pr-merged Celebration Event adds the configured merge points to the Team Score", async () => {
  running = await start();

  await postWebhook(running.port, { body: merged });

  expect((await readSnapshot(running.port)).teamScore).toBe(70);
});

test("a review-approved Celebration Event adds the configured approval points to the Team Score", async () => {
  running = await start();

  await postWebhook(running.port, {
    body: review,
    event: "pull_request_review",
  });

  expect((await readSnapshot(running.port)).teamScore).toBe(9);
});

// A second merge of the SAME PR is a repeat and scores nothing (deduped for the week);
// distinct PRs are what accumulate.
const secondMerge = JSON.stringify({
  ...JSON.parse(merged),
  pull_request: { ...JSON.parse(merged).pull_request, number: 43, title: "Add jingles" },
});

test("Celebration Events for distinct PRs accumulate into a single shared Team Score", async () => {
  running = await start();

  await postWebhook(running.port, { body: merged });
  await postWebhook(running.port, { body: merged }); // repeat: dropped, scores nothing
  await postWebhook(running.port, { body: secondMerge });
  await postWebhook(running.port, {
    body: review,
    event: "pull_request_review",
  });

  expect((await readSnapshot(running.port)).teamScore).toBe(149);
});

test("a display connecting to a server with no events sees a Team Score of zero", async () => {
  running = await start();

  expect((await readSnapshot(running.port)).teamScore).toBe(0);
});

test.for([
  ["a pr-opened", opened, "pull_request"],
  ["a changes-requested", changesRequested, "pull_request_review"],
  ["a pr-comment", comment, "issue_comment"],
])("%s Ambient Event leaves the Team Score unchanged", async ([, body, event]) => {
  running = await start();

  await postWebhook(running.port, { body: body!, event });

  expect((await readSnapshot(running.port)).teamScore).toBe(0);
});

test("a live Celebration Event delivery carries the updated Team Score to a connected display", async () => {
  running = await start();
  const { ws, messages } = await connectedDisplay(running.port);

  await postWebhook(running.port, { body: merged });
  await sleep(50);
  ws.close();

  // The Team Score after the delivery, without the display having to reconnect.
  expect(messages.at(-1).teamScore).toBe(70);
});

test("a display left connected across Monday 00:00 is pushed the reset Team Score", async () => {
  let clock = new Date(2026, 7, 14, 9, 0, 0).getTime(); // Friday
  running = await startServer(0, { configPath, now: () => clock, tickMs: 10 });
  await postWebhook(running.port, { body: merged });
  const { ws, messages } = await connectedDisplay(running.port);

  // Monday 08:30: past the reset, clear of the 09:00 Day Chime.
  clock = new Date(2026, 7, 17, 8, 30, 0).getTime();
  await sleep(100);
  ws.close();

  const snapshots = messages.filter((m) => m.type === "snapshot");
  // The snapshot sent on connect, then exactly one for the week rolling over —
  // not one per tick.
  expect(snapshots.map((s) => s.teamScore)).toEqual([70, 0]);
});

test("advancing the clock across Monday 00:00 resets the Team Score to zero", async () => {
  // Friday, then the following Monday morning — both local time, as the reset is.
  let clock = new Date(2026, 7, 14, 9, 0, 0).getTime();
  running = await start(() => clock);

  await postWebhook(running.port, { body: merged });
  const friday = await readSnapshot(running.port);
  clock = new Date(2026, 7, 17, 9, 0, 0).getTime();
  const monday = await readSnapshot(running.port);

  expect(friday.teamScore).toBe(70);
  expect(monday.teamScore).toBe(0);
});

test("Celebration Events after the Monday reset score from zero again", async () => {
  let clock = new Date(2026, 7, 14, 9, 0, 0).getTime();
  running = await start(() => clock);

  await postWebhook(running.port, { body: merged });
  clock = new Date(2026, 7, 17, 9, 0, 0).getTime();
  await postWebhook(running.port, {
    body: review,
    event: "pull_request_review",
  });

  expect((await readSnapshot(running.port)).teamScore).toBe(9);
});

test.for([
  ["has no point values", "config-missing-points.json"],
  ["has a point value that is not a number", "config-points-not-numbers.json"],
])("the server refuses to start when the config %s", async ([, file]) => {
  await expect(
    startServer(0, { configPath: badConfigPath(file!) }),
  ).rejects.toThrow(
    /points/,
  );
});

test("a freshly opened PR appears at the head of the In Flight list, not buried at the tail", async () => {
  running = await start();

  await postWebhook(running.port, { body: opened }); // #42
  const newest = JSON.stringify({
    ...JSON.parse(merged),
    action: "opened",
    pull_request: { ...JSON.parse(merged).pull_request, number: 77, title: "Newest work", merged: false },
  });
  await postWebhook(running.port, { body: newest });

  const snapshot = await readSnapshot(running.port);
  expect(snapshot.openPrs.map((pr: any) => pr.number)).toEqual([77, 42]);
});
