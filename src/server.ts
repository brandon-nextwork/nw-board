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
  /** Who did it. Never undefined on the wire: an unnamed GitHub user is "". */
  actor: string;
};

/** The login of whoever GitHub named, or "" when it named nobody. */
const login = (who: any) => who?.login ?? "";

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
      return { type: "pr-opened", repo, number, title, actor: login(pr.user) };
    if (payload.action === "closed")
      return {
        type: pr.merged ? "pr-merged" : "pr-closed",
        repo,
        number,
        title,
        // A merge belongs to whoever pressed the button; the author stands in when
        // GitHub names no merger.
        actor: (pr.merged && login(pr.merged_by)) || login(pr.user),
      };
  }

  if (githubEvent === "pull_request_review" && payload.action === "submitted") {
    const actor = login(payload.review?.user);
    if (payload.review?.state === "approved")
      return { type: "review-approved", repo, number, title, actor };
    if (payload.review?.state === "changes_requested")
      return { type: "changes-requested", repo, number, title, actor };
  }

  // Only comments on pull requests count; plain issue comments have no `pull_request`.
  if (
    githubEvent === "issue_comment" &&
    payload.action === "created" &&
    pr.pull_request
  ) {
    // The PR comes from `issue`, but the actor is the commenter.
    return {
      type: "pr-comment",
      repo,
      number,
      title,
      actor: login(payload.comment?.user),
    };
  }

  return undefined;
}

/** Celebration Events are the loud ones; everything else is an Ambient Event. */
const CELEBRATIONS = new Set(["pr-merged", "review-approved"]);

/** The events that add to or remove from the list of currently open PRs. */
const IN_FLIGHT_CHANGES = new Set(["pr-opened", "pr-merged", "pr-closed"]);

/** "09:00" -> 540 minutes past local midnight. Anything else is a config error. */
function minutesOfDay(value: unknown, complaint: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value));
  if (!match) throw new Error(complaint);
  return Number(match[1]) * 60 + Number(match[2]);
}

type Options = {
  /** Path to the JSON config holding the Tracked Repo list. */
  configPath?: string;
  now?: () => number;
  /** Root of the GitHub REST API; tests point this at a stub. */
  githubApiBase?: string;
  /** How often the Day Chime scheduler checks the clock. */
  tickMs?: number;
};

/** Monday 00:00 local time of the week containing `at` — the Team Score week. */
function startOfWeek(at: number) {
  const monday = new Date(at);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday.getTime();
}

export async function startServer(port: number, options: Options = {}) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) throw new Error("GITHUB_WEBHOOK_SECRET is not set");

  const configPath =
    options.configPath ?? fileURLToPath(new URL("../config.json", import.meta.url));
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const trackedRepos: string[] = config.trackedRepos;
  // A missing list would 400 every delivery; a bare string would match repos by substring.
  if (!Array.isArray(trackedRepos))
    throw new Error(`${configPath}: trackedRepos must be a list of "owner/name"`);

  // Point values for the Celebration Events. Refuse to boot rather than score
  // every merge as zero because someone fat-fingered the config.
  const points: Record<string, number> = config.points ?? {};
  for (const type of ["pr-merged", "review-approved"])
    if (typeof points[type] !== "number")
      throw new Error(`${configPath}: points.${type} must be a number`);

  // Quiet Hours: sound is allowed on weekdays between these two local times only.
  const quietHours = `${configPath}: quietHours must be {"soundStart":"HH:MM","soundEnd":"HH:MM"}`;
  const soundStart = minutesOfDay(config.quietHours?.soundStart, quietHours);
  const soundEnd = minutesOfDay(config.quietHours?.soundEnd, quietHours);
  // Day Chimes: local times, weekdays only.
  const badChimes = `${configPath}: chimes must be a list of "HH:MM"`;
  if (!Array.isArray(config.chimes)) throw new Error(badChimes);
  const chimes: string[] = config.chimes;
  for (const chime of chimes) minutesOfDay(chime, badChimes);

  const now = options.now ?? Date.now;
  const isWeekday = (at: Date) => at.getDay() >= 1 && at.getDay() <= 5;
  const soundAllowed = () => {
    const at = new Date(now());
    const minute = at.getHours() * 60 + at.getMinutes();
    return isWeekday(at) && minute >= soundStart && minute < soundEnd;
  };

  // The Feed: every tracked domain event from the last 24 hours, oldest first.
  const feed: { at: number; event: DomainEvent }[] = [];
  const DAY_MS = 24 * 60 * 60 * 1000;
  const currentFeed = () => {
    while (feed.length && now() - feed[0]!.at >= DAY_MS) feed.shift();
    // Each entry carries the timestamp it was recorded at, so a display expires it
    // by when it happened rather than when the snapshot happened to arrive.
    return feed.map(({ at, event }) => ({ ...event, at }));
  };

  // The currently open PRs: board state rather than a 24h event, so an open PR sits
  // on the board however long ago it was opened. Backfill fills it; a pr-opened adds,
  // a pr-merged or pr-closed removes.
  const openPrs: {
    repo: string;
    number: number;
    title: string;
    actor: string;
  }[] = [];

  // The Team Score: this week's Celebration Event points. Derived on read, so the
  // weekly reset needs no timer — crossing Monday 00:00 simply zeroes it.
  let score = 0;
  let scoreWeek = startOfWeek(now());
  // The event types Backfill can rediscover after a restart, so a repeat delivery of
  // one is the same event rather than a new one. Kept for the whole score week (not
  // the Feed's 24h) so a redelivered merge cannot score twice. Ambient repeats — a
  // second comment or a second changes-requested review — are genuinely new events.
  const BACKFILLED = new Set(["pr-merged", "pr-opened", "review-approved"]);
  const seen = new Set<string>();
  const teamScore = () => {
    const week = startOfWeek(now());
    if (week !== scoreWeek) {
      scoreWeek = week;
      score = 0;
      seen.clear();
    }
    return score;
  };

  /**
   * The one path into state: append to the Feed and credit the Team Score.
   * Webhooks and Backfill both land here (Backfill with the event's real `at`),
   * so the weekly score rebuilds from Backfill for free. Repeats of a Backfillable
   * event (same type/repo/number, this week) are dropped — that's what stops a
   * webhook duplicating what Backfill already fetched. Returns the points credited
   * (0 for Ambient Events and older weeks), or null for a dropped repeat.
   */
  const recordEvent = (event: DomainEvent, at: number = now()): number | null => {
    // An event with no parseable timestamp (a Backfilled PR missing created_at, say)
    // would sit in the Feed forever: the expiry loop stops at the first entry it
    // cannot age out. Undateable is unshowable, so drop it.
    if (!Number.isFinite(at)) return null;
    teamScore(); // roll the week over before deduping or crediting
    const key = `${event.type}/${event.repo}/${event.number}`;
    if (BACKFILLED.has(event.type)) {
      if (seen.has(key)) return null;
      seen.add(key);
    }
    feed.push({ at, event });
    const { type, repo, number, title, actor } = event;
    const open = openPrs.findIndex(
      (pr) => pr.repo === repo && pr.number === number,
    );
    if (type === "pr-opened" && open < 0)
      openPrs.push({ repo, number, title, actor });
    if ((type === "pr-merged" || type === "pr-closed") && open >= 0)
      openPrs.splice(open, 1);
    const earned = startOfWeek(at) === scoreWeek ? (points[event.type] ?? 0) : 0;
    score += earned;
    return earned;
  };

  const app = express();
  app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));
  const http = createServer(app);
  const wss = new WebSocketServer({ server: http });

  // Display protocol (server -> client only):
  //   on connect: {"type":"snapshot","feed":[{<domain event>, "at":<ms>}, ...],
  //                "teamScore":<number>,"openPrs":[{repo, number, title, actor}, ...]}
  //               feed is oldest first and holds the last 24h, each entry stamped with
  //               the server time it happened; openPrs is the current set of open PRs
  //               (state, so no 24h expiry) — what's in flight now, each with the
  //               GitHub login of its author.
  //   live:       <domain event> = {"type":"pr-merged"|..., repo, number, title, actor}
  //               actor is the GitHub login of whoever did it (the merger for a
  //               pr-merged, the reviewer for a review, the commenter for a comment),
  //               always a string — "" when GitHub named nobody.
  //               Celebration Events carry "audible": true|false — Quiet Hours decided
  //               at delivery time. Ambient Events never make sound, so carry no flag.
  //   chime:      {"type":"day-chime","at":"09:00"}  (weekdays, on the configured times)
  // No domain event type is called "snapshot" or "day-chime", so `type` tells them apart.
  const broadcast = (message: unknown) => {
    for (const client of wss.clients) client.send(JSON.stringify(message));
  };
  const snapshot = () => ({
    type: "snapshot",
    feed: currentFeed(),
    teamScore: teamScore(),
    openPrs,
  });
  wss.on("connection", (socket) => socket.send(JSON.stringify(snapshot())));

  /**
   * Backfill: rebuild the Feed from the GitHub API so a fresh boot is never blank and
   * downtime leaves no gap. Fetches back to the start of the week (not just the Feed's
   * 24h) because the Team Score is rebuilt from the week's Celebration Events.
   * Any failure is logged and skipped — live webhooks still work without it.
   */
  async function backfill() {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      console.warn(
        "GITHUB_TOKEN is not set: skipping Backfill, the board will fill from live webhooks only",
      );
      return;
    }
    const apiBase = options.githubApiBase ?? "https://api.github.com";
    const weekStart = startOfWeek(now());
    const entries: { at: number; event: DomainEvent }[] = [];

    /** GET a list under /repos, e.g. "owner/name/pulls?state=open". */
    const get = async (path: string) => {
      const response = await fetch(`${apiBase}/repos/${path}`, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
        },
      });
      if (!response.ok)
        throw new Error(`GitHub API ${response.status} for ${path}`);
      return (await response.json()) as any[];
    };

    for (const repo of trackedRepos) {
      // PRs touched this week, whose reviews may hold this week's approvals.
      const active: any[] = [];
      for (const pr of await get(`${repo}/pulls?state=open&per_page=100`)) {
        entries.push({
          at: Date.parse(pr.created_at),
          event: {
            type: "pr-opened",
            repo,
            number: pr.number,
            title: pr.title,
            actor: login(pr.user),
          },
        });
        if (Date.parse(pr.updated_at) >= weekStart) active.push(pr);
      }
      // Closed PRs come back newest-updated first, so we can stop at the first one
      // that predates the week.
      // ponytail: one page per repo — the ceiling is 100 closed PRs per repo per
      // week; page through only if a repo ever outruns that.
      for (const pr of await get(
        `${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`,
      )) {
        if (Date.parse(pr.updated_at) < weekStart) break;
        active.push(pr);
        const mergedAt = pr.merged_at ? Date.parse(pr.merged_at) : 0;
        if (mergedAt >= weekStart)
          entries.push({
            at: mergedAt,
            event: {
              type: "pr-merged",
              repo,
              number: pr.number,
              title: pr.title,
              // The list API returns no merged_by, so the author is an honest lazy
              // stand-in for the merger.
              actor: login(pr.user),
            },
          });
      }
      // Approvals are Celebration Events, so the Team Score only survives a restart
      // if this week's are refetched too. One request per PR touched this week; a
      // repo that refuses the read loses its approvals, not the whole Backfill.
      for (const pr of active) {
        let reviews: any[];
        try {
          reviews = await get(`${repo}/pulls/${pr.number}/reviews`);
        } catch (error) {
          console.warn(`Backfill skipped reviews for ${repo}#${pr.number}: ${error}`);
          continue;
        }
        for (const review of reviews) {
          const at = Date.parse(review.submitted_at);
          if (review.state !== "APPROVED" || !(at >= weekStart)) continue;
          entries.push({
            at,
            event: {
              type: "review-approved",
              repo,
              number: pr.number,
              title: pr.title,
              actor: login(review.user),
            },
          });
        }
      }
    }

    // Oldest first, matching the Feed's order (its 24h expiry shifts off the front).
    for (const { at, event } of entries.sort((a, b) => a.at - b.at))
      recordEvent(event, at);
  }

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
      const earned = recordEvent(event);
      // null = repeat of something already recorded (e.g. Backfill got there
      // first): no state change, so nothing to tell the displays.
      if (earned !== null) {
        broadcast(
          CELEBRATIONS.has(event.type)
            ? { ...event, audible: soundAllowed() }
            : event,
        );
        // A Celebration Event moved the Team Score, and an open/merged/closed moved the
        // in-flight list: follow either with a fresh snapshot rather than inventing a
        // second message shape for state the snapshot already carries.
        if (earned || IN_FLIGHT_CHANGES.has(event.type)) broadcast(snapshot());
      }
    }
    res.sendStatus(204);
  });

  // Everything that can fail here is a bad delivery; never let express render a stack.
  app.use(((err, _req, res, _next) => {
    res.sendStatus(err.status ?? 400);
  }) satisfies ErrorRequestHandler);

  await backfill().catch((error) =>
    console.warn(`Backfill failed, serving live events only: ${error}`),
  );

  // Day Chime scheduler: poll the clock rather than compute a delay, so the injected
  // clock (and a Pi whose time jumps after an NTP sync) is followed rather than trusted.
  // `fired` keeps a chime to one per minute however many ticks land inside it.
  let fired = "";
  const scheduler = setInterval(() => {
    const at = new Date(now());
    // The Team Score resets on read, so a display connected across Monday 00:00 would
    // keep last week's number until something else happened. `snapshot()` reads (and
    // so rolls) the week, which is why this fires once rather than every tick.
    if (startOfWeek(at.getTime()) !== scoreWeek) broadcast(snapshot());
    const hhmm = `${at.getHours()}`.padStart(2, "0") + ":" + `${at.getMinutes()}`.padStart(2, "0");
    const minute = `${at.toDateString()} ${hhmm}`;
    if (fired === minute || !isWeekday(at) || !chimes.includes(hhmm)) return;
    fired = minute;
    // By design: a chime that lands while no display is connected is dropped, not
    // replayed later. This is a display-only board, and a stale 09:00 chime at 09:20
    // is worse than silence.
    broadcast({ type: "day-chime", at: hhmm });
  }, options.tickMs ?? 30_000);

  await new Promise<void>((resolve) => http.listen(port, resolve));
  return {
    port: (http.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(scheduler);
        for (const client of wss.clients) client.terminate();
        http.close(() => resolve());
      }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { port } = await startServer(Number(process.env.PORT ?? 3000));
  console.log(`PR Arcade on http://localhost:${port}`);
}
