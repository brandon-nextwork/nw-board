import { createHmac } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, expect, test } from "vitest";
import { WebSocket } from "ws";
import { startServer } from "../src/server.ts";

const SECRET = "test-webhook-secret";
process.env.GITHUB_WEBHOOK_SECRET = SECRET;
// Backfill belongs to backfill.test.ts; without a token these tests never reach the
// GitHub API, whatever the shell running them has exported.
delete process.env.GITHUB_TOKEN;

const rawBody = readFileSync(
  new URL("./fixtures/pull-request-merged.json", import.meta.url),
  "utf8",
);

const sign = (body: string, secret = SECRET) =>
  "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

const configPath = fileURLToPath(
  new URL("./fixtures/config.json", import.meta.url),
);
const start = (now?: () => number) => startServer(0, { configPath, now });

let running: { port: number; close: () => Promise<void> } | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

type PostOptions = {
  body?: string;
  event?: string;
  signature?: string;
  contentType?: string;
};

const postWebhook = (
  port: number,
  {
    body = rawBody,
    event = "pull_request",
    signature = sign(body),
    contentType = "application/json",
  }: PostOptions = {},
) =>
  fetch(`http://127.0.0.1:${port}/webhook`, {
    method: "POST",
    headers: {
      ...(contentType ? { "content-type": contentType } : {}),
      "x-github-event": event,
      ...(signature ? { "x-hub-signature-256": signature } : {}),
    },
    // Uint8Array so fetch adds no Content-Type of its own when we omit it.
    body: new TextEncoder().encode(body),
  });

/** Connect a display, recording every protocol message from the moment it opens. */
async function connectedDisplay(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages: any[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(String(data))));
  await once(ws, "open");
  return { ws, messages };
}

/** POST a webhook and collect the domain events the display received afterwards. */
async function postAndWatch(port: number, options?: PostOptions) {
  const { ws, messages } = await connectedDisplay(port);

  const response = await postWebhook(port, options);
  await sleep(50);
  ws.close();
  // The snapshot sent on connect is asserted separately.
  return {
    status: response.status,
    received: messages.filter((message) => message.type !== "snapshot"),
  };
}

test("a signed merged-PR webhook from a Tracked Repo pushes a pr-merged Celebration Event to the display", async () => {
  running = await start();

  const { status, received } = await postAndWatch(running.port);

  expect(status).toBe(204);
  expect(received).toEqual([
    {
      type: "pr-merged",
      repo: "nextworkengineering/projects-app",
      number: 42,
      title: "Add arcade scene renderer",
    },
  ]);
});

test.for([
  ["a wrong", sign(rawBody, "not-the-webhook-secret")],
  ["a missing", ""],
])(
  "a merged-PR webhook with %s signature is rejected and pushes no Celebration Event",
  async ([, signature]) => {
    running = await start();

    const { status, received } = await postAndWatch(running.port, {
      signature,
    });

    expect(status).toBe(401);
    expect(received).toEqual([]);
  },
);

const fixture = JSON.parse(rawBody);

test("a merged-PR webhook with a very long PR description still pushes the Celebration Event", async () => {
  running = await start();
  const body = JSON.stringify({
    ...fixture,
    pull_request: { ...fixture.pull_request, body: "x".repeat(200_000) },
  });

  const { status, received } = await postAndWatch(running.port, { body });

  expect(status).toBe(204);
  expect(received).toEqual([
    {
      type: "pr-merged",
      repo: "nextworkengineering/projects-app",
      number: 42,
      title: "Add arcade scene renderer",
    },
  ]);
});

const reviewBody = readFileSync(
  new URL("./fixtures/pull-request-review.json", import.meta.url),
  "utf8",
);
const review = JSON.parse(reviewBody);
const commentBody = readFileSync(
  new URL("./fixtures/issue-comment.json", import.meta.url),
  "utf8",
);

const withPullRequest = (patch: Record<string, unknown>) =>
  JSON.stringify({
    ...fixture,
    ...patch,
    pull_request: { ...fixture.pull_request, merged: false },
  });

test.for([
  [
    "a pr-opened Ambient Event",
    { body: withPullRequest({ action: "opened" }) },
    {
      type: "pr-opened",
      repo: "nextworkengineering/projects-app",
      number: 42,
      title: "Add arcade scene renderer",
    },
  ],
  [
    "a pr-closed Ambient Event",
    { body: withPullRequest({ action: "closed" }) },
    {
      type: "pr-closed",
      repo: "nextworkengineering/projects-app",
      number: 42,
      title: "Add arcade scene renderer",
    },
  ],
  [
    "a review-approved Celebration Event",
    { body: reviewBody, event: "pull_request_review" },
    {
      type: "review-approved",
      repo: "nextworkengineering/features",
      number: 7,
      title: "Wire up the Feed",
    },
  ],
  [
    "a changes-requested Ambient Event",
    {
      body: JSON.stringify({
        ...review,
        review: { state: "changes_requested" },
      }),
      event: "pull_request_review",
    },
    {
      type: "changes-requested",
      repo: "nextworkengineering/features",
      number: 7,
      title: "Wire up the Feed",
    },
  ],
  [
    "a pr-comment Ambient Event",
    { body: commentBody, event: "issue_comment" },
    {
      type: "pr-comment",
      repo: "nextworkengineering/content",
      number: 13,
      title: "Load the sprite sheet",
    },
  ],
])("a signed webhook from a Tracked Repo pushes %s to the display", async ([
  ,
  options,
  expected,
]) => {
  running = await start();

  const { status, received } = await postAndWatch(
    running.port,
    options as PostOptions,
  );

  expect(status).toBe(204);
  expect(received).toEqual([expected]);
});

test.for([
  ["the ping sent when a webhook is registered", { event: "ping", body: '{"zen":"Non-blocking is better than blocking."}' }],
  [
    "a review dismissed rather than submitted",
    { body: JSON.stringify({ ...review, action: "dismissed" }), event: "pull_request_review" },
  ],
  [
    "a comment on an issue that is not a pull request",
    {
      body: '{"action":"created","issue":{"number":9,"title":"Wishlist"},"repository":{"full_name":"nextworkengineering/projects-app"}}',
      event: "issue_comment",
    },
  ],
  [
    "a delivery with no pull request at all",
    { body: '{"action":"closed","repository":{"full_name":"nextworkengineering/projects-app"}}' },
  ],
])(
  "%s is accepted but pushes no domain event",
  async ([, options]) => {
    running = await start();

    const { status, received } = await postAndWatch(
      running.port,
      options as PostOptions,
    );

    expect(status).toBe(204);
    expect(received).toEqual([]);
  },
);

test("a merged-PR webhook from a repo that is not a Tracked Repo is accepted but pushes no domain event", async () => {
  running = await start();
  const body = JSON.stringify({
    ...fixture,
    repository: { full_name: "someone-else/not-our-repo" },
  });

  const { status, received } = await postAndWatch(running.port, { body });

  expect(status).toBe(204);
  expect(received).toEqual([]);
  const snapshot = await connectAndReadSnapshot(running.port);
  expect(snapshot.feed).toEqual([]);
});

/** Connect a display and read the snapshot it is sent on connect. */
async function connectAndReadSnapshot(port: number) {
  const { ws, messages } = await connectedDisplay(port);
  await sleep(50);
  ws.close();
  return messages[0];
}

test("a display connecting receives a snapshot of the Feed reflecting earlier events", async () => {
  running = await start();
  await postWebhook(running.port);
  await postWebhook(running.port, {
    body: commentBody,
    event: "issue_comment",
  });

  const snapshot = await connectAndReadSnapshot(running.port);

  expect(snapshot).toEqual({
    type: "snapshot",
    feed: [
      {
        type: "pr-merged",
        repo: "nextworkengineering/projects-app",
        number: 42,
        title: "Add arcade scene renderer",
      },
      {
        type: "pr-comment",
        repo: "nextworkengineering/content",
        number: 13,
        title: "Load the sprite sheet",
      },
    ],
  });
});

test("a display that reconnects after a dropped socket receives a fresh snapshot", async () => {
  running = await start();
  await postWebhook(running.port);

  const firstSnapshot = await connectAndReadSnapshot(running.port);
  await postWebhook(running.port, {
    body: commentBody,
    event: "issue_comment",
  });
  const secondSnapshot = await connectAndReadSnapshot(running.port);

  expect(firstSnapshot.feed).toHaveLength(1);
  expect(secondSnapshot.feed).toEqual([
    {
      type: "pr-merged",
      repo: "nextworkengineering/projects-app",
      number: 42,
      title: "Add arcade scene renderer",
    },
    {
      type: "pr-comment",
      repo: "nextworkengineering/content",
      number: 13,
      title: "Load the sprite sheet",
    },
  ]);
});

test.for([
  [
    "a review delivery carrying no pull request",
    {
      event: "pull_request_review",
      body: '{"action":"submitted","review":{"state":"approved"},"repository":{"full_name":"nextworkengineering/features"}}',
    },
  ],
  [
    "an opened delivery whose pull request is not an object",
    {
      body: '{"action":"opened","pull_request":"nope","repository":{"full_name":"nextworkengineering/projects-app"}}',
    },
  ],
  [
    "a PR comment delivery whose issue has no number",
    {
      event: "issue_comment",
      body: '{"action":"created","issue":{"pull_request":{}},"repository":{"full_name":"nextworkengineering/content"}}',
    },
  ],
])(
  "%s is accepted, pushes no domain event, and leaves the Feed empty",
  async ([, options]) => {
    running = await start();

    const { status, received } = await postAndWatch(
      running.port,
      options as PostOptions,
    );

    expect(status).toBe(204);
    expect(received).toEqual([]);
    const snapshot = await connectAndReadSnapshot(running.port);
    expect(snapshot.feed).toEqual([]);
  },
);

test("advancing the clock 24 hours past an event expires it from later Feed snapshots", async () => {
  const HOUR = 60 * 60 * 1000;
  let clock = Date.parse("2026-08-13T09:00:00Z");
  running = await start(() => clock);

  await postWebhook(running.port);
  clock += 23 * HOUR;
  await postWebhook(running.port, {
    body: commentBody,
    event: "issue_comment",
  });
  clock += 1 * HOUR;

  const snapshot = await connectAndReadSnapshot(running.port);

  expect(snapshot.feed).toEqual([
    {
      type: "pr-comment",
      repo: "nextworkengineering/content",
      number: 13,
      title: "Load the sprite sheet",
    },
  ]);
});

test("a signed delivery with a malformed body is rejected without leaking a stack trace", async () => {
  running = await start();

  const response = await postWebhook(running.port, { body: "not json" });

  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain("/Users");
});

test.for([
  ["has no Tracked Repo list", "config-missing-tracked-repos.json"],
  ["has a Tracked Repo list that is not a list", "config-tracked-repos-not-a-list.json"],
])("the server refuses to start when the config %s", async ([, file]) => {
  const badConfig = fileURLToPath(
    new URL(`./fixtures/${file}`, import.meta.url),
  );

  await expect(startServer(0, { configPath: badConfig })).rejects.toThrow(
    /trackedRepos/,
  );
});

test("the server refuses to start without a webhook secret configured", async () => {
  delete process.env.GITHUB_WEBHOOK_SECRET;
  try {
    await expect(startServer(0)).rejects.toThrow(/GITHUB_WEBHOOK_SECRET/);
  } finally {
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  }
});

test("an unsigned webhook with no Content-Type is rejected and pushes no Celebration Event", async () => {
  running = await start();

  const { status, received } = await postAndWatch(running.port, {
    contentType: "",
    signature: "",
  });

  expect(status).toBe(401);
  expect(received).toEqual([]);
});
