import { createHmac } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { WebSocket } from "ws";
import { startServer } from "../src/server.ts";

const SECRET = "test-webhook-secret";
process.env.GITHUB_WEBHOOK_SECRET = SECRET;

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const configPath = fileURLToPath(
  new URL("./fixtures/config.json", import.meta.url),
);

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

const postWebhook = (port: number, body: string, event = "pull_request") =>
  fetch(`http://127.0.0.1:${port}/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-hub-signature-256":
        "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex"),
    },
    body: new TextEncoder().encode(body),
  });

/** Connect a display and read the snapshot it is sent on connect. */
async function readSnapshot(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages: any[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(String(data))));
  await once(ws, "open");
  await sleep(50);
  ws.close();
  return messages[0];
}

test("a pr-merged Celebration Event adds the configured merge points to the Team Score", async () => {
  running = await start();

  await postWebhook(running.port, merged);

  expect((await readSnapshot(running.port)).teamScore).toBe(70);
});

test("a review-approved Celebration Event adds the configured approval points to the Team Score", async () => {
  running = await start();

  await postWebhook(running.port, review, "pull_request_review");

  expect((await readSnapshot(running.port)).teamScore).toBe(9);
});

test("repeated Celebration Events accumulate into a single shared Team Score", async () => {
  running = await start();

  await postWebhook(running.port, merged);
  await postWebhook(running.port, merged);
  await postWebhook(running.port, review, "pull_request_review");

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

  await postWebhook(running.port, body!, event);

  expect((await readSnapshot(running.port)).teamScore).toBe(0);
});

test("a live Celebration Event delivery carries the updated Team Score to a connected display", async () => {
  running = await start();
  const ws = new WebSocket(`ws://127.0.0.1:${running.port}`);
  const messages: any[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(String(data))));
  await once(ws, "open");

  await postWebhook(running.port, merged);
  await sleep(50);
  ws.close();

  // The Team Score after the delivery, without the display having to reconnect.
  expect(messages.at(-1).teamScore).toBe(70);
});

test("advancing the clock across Monday 00:00 resets the Team Score to zero", async () => {
  // Friday, then the following Monday morning — both local time, as the reset is.
  let clock = new Date(2026, 7, 14, 9, 0, 0).getTime();
  running = await start(() => clock);

  await postWebhook(running.port, merged);
  const friday = await readSnapshot(running.port);
  clock = new Date(2026, 7, 17, 9, 0, 0).getTime();
  const monday = await readSnapshot(running.port);

  expect(friday.teamScore).toBe(70);
  expect(monday.teamScore).toBe(0);
});

test("Celebration Events after the Monday reset score from zero again", async () => {
  let clock = new Date(2026, 7, 14, 9, 0, 0).getTime();
  running = await start(() => clock);

  await postWebhook(running.port, merged);
  clock = new Date(2026, 7, 17, 9, 0, 0).getTime();
  await postWebhook(running.port, review, "pull_request_review");

  expect((await readSnapshot(running.port)).teamScore).toBe(9);
});

test.for([
  ["has no point values", "config-missing-points.json"],
  ["has a point value that is not a number", "config-points-not-numbers.json"],
])("the server refuses to start when the config %s", async ([, file]) => {
  const badConfig = fileURLToPath(
    new URL(`./fixtures/${file}`, import.meta.url),
  );

  await expect(startServer(0, { configPath: badConfig })).rejects.toThrow(
    /points/,
  );
});
