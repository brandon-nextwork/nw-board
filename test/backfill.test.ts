import { createHmac } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { WebSocket } from "ws";
import { startServer } from "../src/server.ts";

const SECRET = "test-webhook-secret";
process.env.GITHUB_WEBHOOK_SECRET = SECRET;
process.env.GITHUB_TOKEN = "test-pat";

const configPath = fileURLToPath(
  new URL("./fixtures/config.json", import.meta.url),
);

// Friday, so "three days ago" is still inside the current week (Mon 00:00).
const NOW = Date.parse("2026-08-14T17:00:00Z");
const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

let running: { port: number; close: () => Promise<void> } | undefined;
const stubs: Server[] = [];
afterEach(async () => {
  await running?.close();
  running = undefined;
  await Promise.all(
    stubs.splice(0).map((s) => new Promise((done) => s.close(done))),
  );
});

/** A stand-in GitHub API: `handler` answers each request, `requests` records them. */
async function stubGitHubApi(handler: (url: string) => unknown) {
  const requests: { url: string; authorization?: string }[] = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url!, authorization: req.headers.authorization });
    const body = handler(req.url!);
    if (typeof body === "number") {
      res.writeHead(body);
      res.end("no");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(typeof body === "string" ? body : JSON.stringify(body ?? []));
  });
  await new Promise<void>((listening) =>
    server.listen(0, "127.0.0.1", listening),
  );
  stubs.push(server);
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, requests };
}

const start = (githubApiBase: string) =>
  startServer(0, { configPath, now: () => NOW, githubApiBase });

/** Connect a display and read the snapshot it is sent on connect. */
async function connectAndReadSnapshot(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages: any[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(String(data))));
  await once(ws, "open");
  await sleep(50);
  ws.close();
  return messages[0];
}

const mergedBody = readFileSync(
  new URL("./fixtures/pull-request-merged.json", import.meta.url),
  "utf8",
);

const postWebhook = (port: number, body = mergedBody) =>
  fetch(`http://127.0.0.1:${port}/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "pull_request",
      "x-hub-signature-256":
        "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex"),
    },
    body: new TextEncoder().encode(body),
  });

/** Answers for one Tracked Repo; the other Tracked Repos have nothing. */
const onlyProjectsApp =
  (open: unknown[], closed: unknown[]) => (url: string) => {
    if (!url.includes("/nextworkengineering/projects-app/")) return [];
    return url.includes("state=open") ? open : closed;
  };

test("a display connecting right after boot receives a snapshot of the backfilled open and merged PRs", async () => {
  const api = await stubGitHubApi(
    onlyProjectsApp(
      [{ number: 1, title: "Open one", created_at: ago(2 * HOUR) }],
      [
        {
          number: 2,
          title: "Merged one",
          updated_at: ago(HOUR),
          merged_at: ago(HOUR),
        },
        {
          number: 3,
          title: "Abandoned one",
          updated_at: ago(3 * HOUR),
          merged_at: null,
        },
      ],
    ),
  );

  running = await start(api.base);

  const snapshot = await connectAndReadSnapshot(running!.port);
  expect(snapshot.feed).toEqual([
    {
      type: "pr-opened",
      repo: "nextworkengineering/projects-app",
      number: 1,
      title: "Open one",
    },
    {
      type: "pr-merged",
      repo: "nextworkengineering/projects-app",
      number: 2,
      title: "Merged one",
    },
  ]);
  expect(api.requests[0]!.authorization).toContain("test-pat");
});

const mergedEvent = {
  type: "pr-merged",
  repo: "nextworkengineering/projects-app",
  number: 42,
  title: "Add arcade scene renderer",
};

test.for([
  // Nothing listens on port 1, so the request is refused outright.
  ["refuses the connection", async () => "http://127.0.0.1:1"],
  ["answers with a 500", async () => (await stubGitHubApi(() => 500)).base],
  [
    "answers with something that is not JSON",
    async () => (await stubGitHubApi(() => "<html>rate limited</html>")).base,
  ],
])(
  "a Backfill against a GitHub API that %s leaves the server running and serving live webhooks",
  async ([, apiBase]) => {
    running = await start(await (apiBase as () => Promise<string>)());

    const response = await postWebhook(running!.port);
    expect(response.status).toBe(204);
    const snapshot = await connectAndReadSnapshot(running!.port);
    expect(snapshot.feed).toEqual([mergedEvent]);
  },
);

test("a webhook for a PR that Backfill already recorded does not duplicate the Feed entry", async () => {
  const api = await stubGitHubApi(
    onlyProjectsApp(
      [],
      [
        {
          number: 42,
          title: "Add arcade scene renderer",
          updated_at: ago(HOUR),
          merged_at: ago(HOUR),
        },
      ],
    ),
  );
  running = await start(api.base);

  await postWebhook(running!.port);

  const snapshot = await connectAndReadSnapshot(running!.port);
  expect(snapshot.feed).toEqual([mergedEvent]);
});

test("Backfilled events older than 24 hours are kept out of the Feed snapshot", async () => {
  const api = await stubGitHubApi(
    onlyProjectsApp(
      [{ number: 1, title: "Stale open one", created_at: ago(72 * HOUR) }],
      [
        {
          number: 2,
          title: "Merged on Tuesday",
          updated_at: ago(72 * HOUR),
          merged_at: ago(72 * HOUR),
        },
        {
          number: 3,
          title: "Merged an hour ago",
          updated_at: ago(HOUR),
          merged_at: ago(HOUR),
        },
      ],
    ),
  );

  running = await start(api.base);

  const snapshot = await connectAndReadSnapshot(running!.port);
  expect(snapshot.feed).toEqual([
    {
      type: "pr-merged",
      repo: "nextworkengineering/projects-app",
      number: 3,
      title: "Merged an hour ago",
    },
  ]);
});

test("a missing GITHUB_TOKEN skips Backfill instead of crashing the server", async () => {
  const api = await stubGitHubApi(
    onlyProjectsApp(
      [{ number: 1, title: "Open one", created_at: ago(HOUR) }],
      [],
    ),
  );
  delete process.env.GITHUB_TOKEN;
  try {
    running = await start(api.base);
  } finally {
    process.env.GITHUB_TOKEN = "test-pat";
  }

  expect((await postWebhook(running!.port)).status).toBe(204);
  const snapshot = await connectAndReadSnapshot(running!.port);
  expect(snapshot.feed).toEqual([mergedEvent]);
  expect(api.requests).toEqual([]);
});
