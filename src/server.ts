import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import express, { type ErrorRequestHandler } from "express";
import { WebSocketServer } from "ws";

type DomainEvent = {
  type: string;
  repo: string;
  number: number;
  title: string;
};

/** Translate a GitHub delivery into the domain vocabulary. Anything else is ignored. */
function toDomainEvent(
  githubEvent: string | undefined,
  payload: any,
): DomainEvent | undefined {
  const repo = payload.repository?.full_name;
  // The PR this delivery is about: issue_comment carries it as `issue`, the rest as
  // `pull_request`. Anything without a numeric `number` is garbage, whatever the shape.
  const pr = githubEvent === "issue_comment" ? payload.issue : payload.pull_request;
  if (typeof pr?.number !== "number") return undefined;
  const { number, title } = pr;

  if (githubEvent === "pull_request") {
    if (payload.action === "opened")
      return { type: "pr-opened", repo, number, title };
    if (payload.action === "closed")
      return {
        type: pr.merged ? "pr-merged" : "pr-closed",
        repo,
        number,
        title,
      };
  }

  if (githubEvent === "pull_request_review" && payload.action === "submitted") {
    if (payload.review?.state === "approved")
      return { type: "review-approved", repo, number, title };
    if (payload.review?.state === "changes_requested")
      return { type: "changes-requested", repo, number, title };
  }

  // Only comments on pull requests count; plain issue comments have no `pull_request`.
  if (
    githubEvent === "issue_comment" &&
    payload.action === "created" &&
    pr.pull_request
  ) {
    return { type: "pr-comment", repo, number, title };
  }

  return undefined;
}

type Options = {
  /** Path to the JSON config holding the Tracked Repo list. */
  configPath?: string;
  now?: () => number;
};

export async function startServer(port: number, options: Options = {}) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) throw new Error("GITHUB_WEBHOOK_SECRET is not set");

  const configPath =
    options.configPath ?? fileURLToPath(new URL("../config.json", import.meta.url));
  const trackedRepos: string[] = JSON.parse(
    readFileSync(configPath, "utf8"),
  ).trackedRepos;
  // A missing list would 400 every delivery; a bare string would match repos by substring.
  if (!Array.isArray(trackedRepos))
    throw new Error(`${configPath}: trackedRepos must be a list of "owner/name"`);

  const now = options.now ?? Date.now;

  // The Feed: every tracked domain event from the last 24 hours, oldest first.
  const feed: { at: number; event: DomainEvent }[] = [];
  const DAY_MS = 24 * 60 * 60 * 1000;
  const currentFeed = () => {
    while (feed.length && now() - feed[0]!.at >= DAY_MS) feed.shift();
    return feed.map((entry) => entry.event);
  };

  const app = express();
  app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));
  const http = createServer(app);
  const wss = new WebSocketServer({ server: http });

  // Display protocol (server -> client only):
  //   on connect: {"type":"snapshot","feed":[<domain event>, ...]}  (oldest first)
  //   live:       <domain event> = {"type":"pr-merged"|..., repo, number, title}
  // No domain event type is called "snapshot", so `type` alone tells them apart.
  wss.on("connection", (socket) =>
    socket.send(JSON.stringify({ type: "snapshot", feed: currentFeed() })),
  );

  app.post("/webhook", express.raw({ type: "*/*", limit: "5mb" }), (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
      res.sendStatus(401);
      return;
    }
    const expected = Buffer.from(
      "sha256=" + createHmac("sha256", secret).update(req.body).digest("hex"),
    );
    const given = Buffer.from(req.header("x-hub-signature-256") ?? "");
    if (
      given.length !== expected.length ||
      !timingSafeEqual(given, expected)
    ) {
      res.sendStatus(401);
      return;
    }

    const payload = JSON.parse(req.body.toString("utf8"));
    const event = toDomainEvent(req.header("x-github-event"), payload);
    if (event && trackedRepos.includes(event.repo)) {
      feed.push({ at: now(), event });
      for (const client of wss.clients) client.send(JSON.stringify(event));
    }
    res.sendStatus(204);
  });

  // Everything that can fail here is a bad delivery; never let express render a stack.
  app.use(((err, _req, res, _next) => {
    res.sendStatus(err.status ?? 400);
  }) satisfies ErrorRequestHandler);

  await new Promise<void>((resolve) => http.listen(port, resolve));
  return {
    port: (http.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        http.close(() => resolve());
      }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { port } = await startServer(Number(process.env.PORT ?? 3000));
  console.log(`PR Arcade on http://localhost:${port}`);
}
