// PR Arcade display client.
//
// Art and audio are generated in the browser rather than fetched: pixel sprites are
// drawn as 8x8 Graphics, baked once into RenderTextures at one texture pixel per art
// pixel and upscaled with nearest-neighbour filtering (that's the chunky look), and
// the 8-bit jingles are WebAudio square/triangle oscillators plus a noise buffer.
// Nothing to download, nothing to license, nothing to keep in sync with the Pi's disk.
//
// PixiJS is served from public/vendor, a symlink to node_modules/pixi.js/dist that the
// existing express.static already covers, so the kiosk never reaches a CDN and works
// with the network down. `npm ci` (install and deploy both run it) provides the target.
import {
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
} from "./vendor/pixi.min.mjs";

// The scene is authored at 1080p and scaled to fit whatever the TV reports, so the
// layout is fixed numbers rather than a responsive system nobody will ever resize.
const W = 1920;
const H = 1080;

const C = {
  bg: 0x0b0b1a,
  panel: 0x141433,
  panelEdge: 0x2b2b6b,
  ink: 0x9fe8ff,
  dim: 0x5b6ba8,
  amber: 0xffe066,
  green: 0x66ddaa,
  red: 0xff5c7a,
  magenta: 0xff7ce5,
  orange: 0xff9a3c,
  white: 0xffffff,
};

const FONT = 'ui-monospace, "DejaVu Sans Mono", "Courier New", monospace';
const label = (text, fontSize, fill, extra) =>
  new Text({ text, style: { fontFamily: FONT, fontSize, fill, letterSpacing: 2, ...extra } });

const EVENTS = {
  "pr-merged": { name: "MERGED", color: C.amber, icon: "trophy" },
  "review-approved": { name: "APPROVED", color: C.green, icon: "check" },
  "pr-opened": { name: "OPENED", color: C.ink, icon: "rocket" },
  "pr-closed": { name: "CLOSED", color: C.dim, icon: "crate" },
  "changes-requested": { name: "CHANGES", color: C.red, icon: "bang" },
  "pr-comment": { name: "COMMENT", color: C.magenta, icon: "bubble" },
};
const CELEBRATIONS = new Set(["pr-merged", "review-approved"]);

// antialias off keeps the pixel art crisp and is one less thing for the Pi's GPU to do.
const app = new Application();
await app.init({ background: C.bg, antialias: false, resizeTo: window });
document.body.appendChild(app.canvas);

// Everything lives under `world`, which is scaled to fit the window. The kiosk runs
// 1920x1080 so the scale is 1 there; anything else letterboxes rather than reflows.
const world = new Container();
app.stage.addChild(world);
function fitToWindow() {
  const scale = Math.min(app.screen.width / W, app.screen.height / H);
  world.scale.set(scale);
  world.position.set(
    (app.screen.width - W * scale) / 2,
    (app.screen.height - H * scale) / 2,
  );
}
app.renderer.on("resize", fitToWindow);
fitToWindow();

// Draw order: background, panels, ambient effects, then celebration takeovers on top.
const layers = {
  back: new Container(),
  board: new Container(),
  fx: new Container(),
  takeover: new Container(),
};
for (const layer of Object.values(layers)) world.addChild(layer);

// --------------------------------------------------------------------------------
// Pixel art. Each sprite is an 8x8 grid of palette letters; '.' is transparent.
// --------------------------------------------------------------------------------

const PX = {
  w: C.white,
  y: C.amber,
  o: C.orange,
  g: C.green,
  b: C.ink,
  r: C.red,
  m: C.magenta,
  d: 0x3a3a6a,
  k: 0x0b0b1a,
};

const SPRITES = {
  trophy: [
    ".yyyyyy.",
    "oyyyyyyo",
    "oyyyyyyo",
    ".yyyyyy.",
    "..yyyy..",
    "...yy...",
    "..oooo..",
    ".oooooo.",
  ],
  // Keep the ink one pixel clear of the 8x8 edge: a stroke that reaches the grid
  // boundary ends in a flat wall instead of a tip, and at the approval takeover's
  // 12-24x slam scale that wall reads as the sprite being cropped.
  check: [
    "........",
    ".....gg.",
    "....gg..",
    ".g.gg...",
    ".ggg....",
    "..gg....",
    "..g.....",
    "........",
  ],
  rocket: [
    "........",
    "...wwww.",
    "..wwwwww",
    "orwwbwww",
    "orwwbwww",
    "..wwwwww",
    "...wwww.",
    "........",
  ],
  crate: [
    "dddddddd",
    "dwwwwwwd",
    "dwddddwd",
    "dwddddwd",
    "dwddddwd",
    "dwddddwd",
    "dwwwwwwd",
    "dddddddd",
  ],
  bang: [
    "...rr...",
    "..rrrr..",
    "..rrrr..",
    "..rrrr..",
    "...rr...",
    "........",
    "..rrrr..",
    "...rr...",
  ],
  bubble: [
    ".mmmmmm.",
    "mwwwwwwm",
    "mwkwkwkm",
    "mwwwwwwm",
    ".mmmmmm.",
    "..mm....",
    ".m......",
    "........",
  ],
  star: [
    "...ww...",
    "...ww...",
    ".wwwwww.",
    "wwwwwwww",
    "wwwwwwww",
    ".wwwwww.",
    "...ww...",
    "...ww...",
  ],
  coin: [
    "..yyyy..",
    ".yooooy.",
    "yoyyyyoy",
    "yoyooyoy",
    "yoyooyoy",
    "yoyyyyoy",
    ".yooooy.",
    "..yyyy..",
  ],
};

// Textures are baked once and shared by every sprite that uses them; nothing in an
// animation ever generates a texture.
const textures = new Map();
function texture(name, draw) {
  let cached = textures.get(name);
  if (!cached) {
    const graphics = new Graphics();
    draw(graphics);
    cached = app.renderer.generateTexture({ target: graphics, resolution: 1 });
    cached.source.scaleMode = "nearest";
    graphics.destroy();
    textures.set(name, cached);
  }
  return cached;
}

function pixelTexture(name) {
  return texture(name, (g) => {
    const rows = SPRITES[name];
    // A transparent backing rect pins the texture to a full 8x8 so every sprite of
    // every shape shares one anchor and one scale.
    g.rect(0, 0, rows[0].length, rows.length).fill({ color: 0, alpha: 0 });
    rows.forEach((row, y) =>
      [...row].forEach((char, x) => {
        if (PX[char] !== undefined) g.rect(x, y, 1, 1).fill(PX[char]);
      }),
    );
  });
}

const dotTexture = () => texture("dot", (g) => g.rect(0, 0, 2, 2).fill(C.white));
const ringTexture = () =>
  texture("ring", (g) => g.circle(20, 20, 18).stroke({ width: 3, color: C.white }));

/** A pixel sprite, sized in art pixels: scale 6 means each art pixel is 6 screen px. */
function pixelSprite(name, scale = 6, tint) {
  const sprite = new Sprite(pixelTexture(name));
  sprite.anchor.set(0.5);
  sprite.scale.set(scale);
  if (tint !== undefined) sprite.tint = tint;
  return sprite;
}

// --------------------------------------------------------------------------------
// Background: CRT-flavoured. Static starfield + grid baked into two Graphics, plus
// scanlines and one slow roll band that move — the only per-frame background work.
// --------------------------------------------------------------------------------

function buildBackground() {
  const stars = new Graphics();
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    stars.rect(x, y, 2, 2).fill({ color: C.ink, alpha: 0.08 + Math.random() * 0.2 });
  }
  layers.back.addChild(stars);

  const grid = new Graphics();
  for (let x = 0; x <= W; x += 60) grid.moveTo(x, 0).lineTo(x, H);
  for (let y = 0; y <= H; y += 60) grid.moveTo(0, y).lineTo(W, y);
  grid.stroke({ width: 1, color: C.panelEdge, alpha: 0.18 });
  layers.back.addChild(grid);

  // Scanlines: 270 dark rows in one static Graphics, drawn over the board so the
  // panels get the CRT texture too.
  const scanlines = new Graphics();
  for (let y = 0; y < H; y += 4) scanlines.rect(0, y, W, 2);
  scanlines.fill({ color: 0x000000, alpha: 0.22 });
  scanlines.eventMode = "none";
  world.addChild(scanlines);

  const roll = new Sprite(dotTexture());
  roll.width = W;
  roll.height = 90;
  roll.alpha = 0.035;
  roll.eventMode = "none";
  world.addChild(roll);
  return roll;
}
const rollBand = buildBackground();

/** A panel: the arcade cabinet bezel every part of the board sits in. */
function panel(x, y, width, height, title, titleColor) {
  const box = new Container();
  box.position.set(x, y);
  const frame = new Graphics()
    .roundRect(0, 0, width, height, 10)
    .fill({ color: C.panel, alpha: 0.85 })
    .stroke({ width: 4, color: C.panelEdge });
  box.addChild(frame);
  const bar = new Graphics()
    .roundRect(0, 0, width, 56, 10)
    .fill({ color: C.panelEdge, alpha: 0.55 });
  box.addChild(bar);
  const heading = label(title, 30, titleColor);
  heading.position.set(20, 12);
  box.addChild(heading);
  layers.board.addChild(box);
  return box;
}

// --------------------------------------------------------------------------------
// Marquee: the Team Score, above everything, with chasing bulbs.
// --------------------------------------------------------------------------------

const marquee = new Container();
marquee.position.set(24, 16);
layers.board.addChild(marquee);
marquee.addChild(
  new Graphics()
    .roundRect(0, 0, 1872, 168, 14)
    .fill({ color: 0x1a0f2e })
    .stroke({ width: 5, color: C.magenta }),
);

const title = label("PR ARCADE", 62, C.magenta, {
  dropShadow: { color: C.ink, distance: 4, blur: 0, angle: Math.PI / 4, alpha: 0.9 },
});
title.position.set(48, 52);
marquee.addChild(title);

const insertCoin = label("INSERT PULL REQUEST", 20, C.dim);
insertCoin.position.set(52, 118);
marquee.addChild(insertCoin);

const scoreCaption = label("TEAM SCORE", 26, C.ink);
scoreCaption.anchor.set(1, 0);
scoreCaption.position.set(1824, 24);
marquee.addChild(scoreCaption);

const scoreDisplay = label("000000", 92, C.amber);
scoreDisplay.anchor.set(1, 0);
scoreDisplay.position.set(1824, 54);
marquee.addChild(scoreDisplay);

const bulbs = Array.from({ length: 44 }, (_, i) => {
  const bulb = new Sprite(pixelTexture("star"));
  bulb.anchor.set(0.5);
  bulb.scale.set(1.4);
  bulb.tint = C.amber;
  const half = 22;
  const top = i < half;
  bulb.position.set(40 + (i % half) * 84, top ? 10 : 158);
  marquee.addChild(bulb);
  return bulb;
});

// --------------------------------------------------------------------------------
// Feed panel: the last 24h of tracked events, newest at the top.
// --------------------------------------------------------------------------------

const FEED_ROWS = 14;
const feedPanel = panel(24, 204, 1160, 852, "LIVE FEED // LAST 24H", C.ink);
const feedEmpty = label("...WAITING FOR PLAYERS...", 26, C.dim);
feedEmpty.position.set(24, 90);
feedPanel.addChild(feedEmpty);

// One row object per line, reused forever: a feed render retints and retexts them
// rather than building and throwing away 14 rows of display objects.
const feedRows = Array.from({ length: FEED_ROWS }, (_, i) => {
  const row = new Container();
  row.position.set(20, 84 + i * 54);
  row.visible = false;
  const icon = pixelSprite("star", 4);
  icon.position.set(24, 22);
  const kind = label("", 24, C.ink);
  kind.position.set(56, 8);
  // Actor gets its own column so the logins line up down the panel; the body
  // gives up the width it takes.
  const who = label("", 24, C.ink);
  who.position.set(196, 8);
  const body = label("", 24, C.dim);
  body.position.set(470, 8);
  row.addChild(icon, kind, who, body);
  feedPanel.addChild(row);
  return { row, icon, kind, who, body };
});

// --------------------------------------------------------------------------------
// In Flight panel: the open PRs, as cabinets on the "now playing" wall.
// --------------------------------------------------------------------------------

const FLIGHT_CARDS = 7;
const flightPanel = panel(1208, 204, 688, 852, "NOW PLAYING // IN FLIGHT", C.green);
const flightEmpty = label("NO PRS IN FLIGHT", 24, C.dim);
flightEmpty.position.set(24, 90);
flightPanel.addChild(flightEmpty);

const flightCards = Array.from({ length: FLIGHT_CARDS }, (_, i) => {
  const card = new Container();
  card.position.set(20, 82 + i * 104);
  card.visible = false;
  card.addChild(
    new Graphics()
      .roundRect(0, 0, 648, 92, 8)
      .fill({ color: 0x1d1d4a })
      .stroke({ width: 3, color: C.green, alpha: 0.6 }),
  );
  const head = label("", 24, C.green);
  head.position.set(16, 12);
  const body = label("", 22, C.ink);
  body.position.set(16, 48);
  card.addChild(head, body);
  flightPanel.addChild(card);
  return { card, head, body };
});

const flightMore = label("", 22, C.dim);
flightMore.position.set(36, 82 + FLIGHT_CARDS * 104);
flightPanel.addChild(flightMore);

// --------------------------------------------------------------------------------
// Board state and rendering.
// --------------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
let feed = [];

// The server only expires the Feed when it builds a snapshot, so a display left
// connected for days has to drop its own stale entries. Snapshot entries carry the
// server time they happened at; a live event is happening right now.
const stamp = (event) => ({ ...event, at: event.at ?? Date.now() });

const clip = (text, max) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
const clock = (at) => new Date(at).toTimeString().slice(0, 5);

function renderFeed() {
  feed = feed.filter((entry) => Date.now() - entry.at < DAY_MS);
  feedEmpty.visible = feed.length === 0;
  for (let i = 0; i < FEED_ROWS; i++) {
    const entry = feed[feed.length - 1 - i];
    const { row, icon, kind, who, body } = feedRows[i];
    row.visible = Boolean(entry);
    if (!entry) continue;
    const style = EVENTS[entry.type] ?? { name: entry.type, color: C.dim, icon: "star" };
    icon.texture = pixelTexture(style.icon);
    kind.text = style.name;
    kind.style.fill = style.color;
    // Clipped to the characters that fit each column at this font size rather than
    // wrapped; a Feed row is a glance, not a read.
    who.text = clip(entry.actor ?? "", 16);
    body.text = clip(
      `${clock(entry.at)}  ${entry.repo.split("/").pop()} #${entry.number}  ${entry.title}`,
      39,
    );
    // Older entries fade toward the bottom of the panel, so the eye lands on the top.
    row.alpha = 1 - i * 0.045;
  }
}

// An idle board still has to age entries out; a minute of granularity is plenty.
setInterval(renderFeed, 60_000);

function renderFlight(openPrs) {
  flightEmpty.visible = openPrs.length === 0;
  for (let i = 0; i < FLIGHT_CARDS; i++) {
    const pr = openPrs[i];
    const { card, head, body } = flightCards[i];
    card.visible = Boolean(pr);
    if (!pr) continue;
    // The author, not whoever last touched it: an open PR belongs to whoever raised it.
    head.text = clip(
      `${pr.repo.split("/").pop()} #${pr.number}  ${pr.actor ?? ""}`.trimEnd(),
      36,
    );
    body.text = clip(pr.title, 38);
  }
  const hidden = openPrs.length - FLIGHT_CARDS;
  flightMore.text = hidden > 0 ? `+${hidden} MORE IN FLIGHT` : "";
}

// Team Score marquee tick-up: the display counts toward the real score instead of
// snapping, which is the whole point of a score display.
let scoreShown = 0;
let scoreTarget = 0;
let scoreClock = 0;
function setScore(value) {
  scoreTarget = value;
  // A weekly reset drops the score; counting down looks broken, so snap instead.
  if (value < scoreShown) {
    scoreShown = value;
    drawScore();
  }
}
function drawScore() {
  scoreDisplay.text = String(scoreShown).padStart(6, "0");
}

// --------------------------------------------------------------------------------
// Animation plumbing: one ticker, scenes that destroy themselves, a particle ceiling.
// --------------------------------------------------------------------------------

// ponytail: 150 live particles is the ceiling the Pi 4 was budgeted for; raise it
// only after watching the frame rate on the actual device.
const MAX_PARTICLES = 150;

/**
 * Add `container` to a layer, drive it with the shared ticker for `duration` ms,
 * then take it off the stage and destroy it. Textures are cached and shared, so
 * destroying children never destroys a texture.
 */
function runScene(layer, container, duration, update, done) {
  layer.addChild(container);
  let elapsed = 0;
  const tick = (ticker) => {
    elapsed += ticker.deltaMS;
    const progress = Math.min(elapsed / duration, 1);
    update(progress, elapsed, ticker.deltaTime);
    if (elapsed >= duration) {
      app.ticker.remove(tick);
      container.destroy({ children: true });
      done?.();
    }
  };
  app.ticker.add(tick);
}

/** A burst of tinted pixel particles. Returns the array for the scene to step. */
function particles(container, count, make) {
  const budget = Math.min(count, MAX_PARTICLES);
  return Array.from({ length: budget }, () => {
    const piece = make();
    container.addChild(piece);
    return piece;
  });
}

function stepParticles(pieces, delta, gravity = 0.18) {
  for (const piece of pieces) {
    piece.x += piece.vx * delta;
    piece.y += piece.vy * delta;
    piece.vy += gravity * delta;
    piece.rotation += piece.spin * delta;
  }
}

// --------------------------------------------------------------------------------
// Sound: 8-bit jingles built from oscillators. Every one is under 3 seconds.
// The kiosk has no user gesture to unblock audio, so Chromium is launched with
// --autoplay-policy=no-user-gesture-required. Anywhere else the context stays
// suspended (or missing) and playback is skipped rather than throwing.
// --------------------------------------------------------------------------------

let audio;
function ready() {
  try {
    audio ??= new AudioContext();
  } catch {
    return false;
  }
  return audio.state === "running";
}

function tone(freq, start, length, { type = "square", gain = 0.1, slideTo } = {}) {
  const at = audio.currentTime + start;
  const oscillator = audio.createOscillator();
  const volume = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(freq, at);
  if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, at + length);
  volume.gain.setValueAtTime(gain, at);
  // Fade each note out; a hard stop on a square wave clicks.
  volume.gain.exponentialRampToValueAtTime(0.001, at + length);
  oscillator.connect(volume).connect(audio.destination);
  oscillator.start(at);
  oscillator.stop(at + length);
}

/** White noise through a decaying envelope: the 8-bit "sparkle"/percussion voice. */
function noise(start, length, gain = 0.07) {
  const frames = Math.ceil(audio.sampleRate * length);
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++)
    samples[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  const source = audio.createBufferSource();
  source.buffer = buffer;
  const volume = audio.createGain();
  volume.gain.value = gain;
  source.connect(volume).connect(audio.destination);
  source.start(audio.currentTime + start);
}

const JINGLES = {
  // Victory fanfare: rising arpeggio into a held octave, with a sparkle on the hit.
  "pr-merged": () => {
    [523, 659, 784, 1047].forEach((freq, i) => tone(freq, i * 0.09, 0.1));
    tone(1047, 0.36, 0.5, { gain: 0.12 });
    tone(1568, 0.36, 0.5, { type: "triangle", gain: 0.07 });
    tone(2093, 0.9, 0.6, { type: "triangle", gain: 0.06 });
    noise(0.36, 0.35, 0.05);
  },
  // Approval: a two-note stab plus a triangle shimmer — same family, clearly not a merge.
  "review-approved": () => {
    tone(784, 0, 0.12, { gain: 0.11 });
    tone(1175, 0.12, 0.32, { gain: 0.11 });
    [1175, 1568].forEach((freq, i) =>
      tone(freq, 0.16 + i * 0.1, 0.28, { type: "triangle", gain: 0.06 }),
    );
    noise(0, 0.12, 0.04);
  },
  // Day Chime: triangle "bells", slower and softer, nothing like a celebration.
  "day-chime": () => {
    [659, 880, 1319, 880].forEach((freq, i) =>
      tone(freq, i * 0.28, 0.7, { type: "triangle", gain: 0.09 }),
    );
    tone(330, 0.84, 1.2, { type: "triangle", gain: 0.05 });
  },
};

function play(name) {
  if (!ready()) return;
  JINGLES[name]?.();
}

// --------------------------------------------------------------------------------
// Celebration takeovers. Queued: two merges landing together play one after the
// other rather than fighting over the middle of the screen.
// --------------------------------------------------------------------------------

const pending = [];
let takeoverBusy = false;

function celebrate(type, event = {}, audible = false) {
  pending.push({ type, event, audible });
  // ponytail: a huge burst of merges would queue up minutes of fanfare; if that ever
  // happens, drop all but the newest few here.
  playNextCelebration();
}

function playNextCelebration() {
  if (takeoverBusy || pending.length === 0) return;
  const next = pending.shift();
  takeoverBusy = true;
  if (next.audible) play(next.type);
  const scene = next.type === "pr-merged" ? mergedTakeover : approvedTakeover;
  scene(next.event, () => {
    takeoverBusy = false;
    playNextCelebration();
  });
}

/**
 * Shared takeover backdrop: dim the board, name the PR, headline in the middle,
 * and credit whoever earned it (`verb` reads "merged by" / "approved by").
 */
function takeoverScene(headline, color, event, verb) {
  const scene = new Container();
  const dim = new Sprite(dotTexture());
  dim.width = W;
  dim.height = H;
  dim.tint = 0x000000;
  dim.alpha = 0;
  scene.addChild(dim);

  const banner = label(headline, 132, color, {
    dropShadow: { color: 0x000000, distance: 6, blur: 0, angle: Math.PI / 4, alpha: 1 },
  });
  banner.anchor.set(0.5);
  banner.position.set(W / 2, H / 2 - 60);
  scene.addChild(banner);

  const caption = label(
    event.repo
      ? `${event.repo.split("/").pop()} #${event.number}  ${clip(event.title ?? "", 46)}`
      : "",
    32,
    C.ink,
  );
  caption.anchor.set(0.5);
  caption.position.set(W / 2, H / 2 + 60);
  scene.addChild(caption);

  // No login means GitHub named nobody; a bare "merged by" credits no one, so skip it.
  const credit = label(event.actor ? `${verb} ${clip(event.actor, 39)}` : "", 40, color);
  credit.anchor.set(0.5);
  credit.position.set(W / 2, H / 2 + 130);
  scene.addChild(credit);
  return { scene, dim, banner, caption, credit };
}

/** pr-merged: the big one — flash, confetti rain, fireworks, bouncing headline. */
function mergedTakeover(event, done) {
  const { scene, dim, banner, caption, credit } = takeoverScene(
    "PR MERGED!",
    C.amber,
    event,
    "merged by",
  );

  const trophy = pixelSprite("trophy", 14);
  trophy.position.set(W / 2, H / 2 - 240);
  scene.addChild(trophy);

  const confetti = particles(scene, 110, () => {
    const piece = new Sprite(dotTexture());
    piece.anchor.set(0.5);
    piece.scale.set(6 + Math.random() * 6);
    piece.tint = [C.amber, C.magenta, C.green, C.ink, C.orange][
      Math.floor(Math.random() * 5)
    ];
    piece.position.set(Math.random() * W, -Math.random() * H);
    piece.vx = (Math.random() - 0.5) * 2;
    piece.vy = 3 + Math.random() * 5;
    piece.spin = (Math.random() - 0.5) * 0.3;
    return piece;
  });

  const fireworks = particles(scene, 36, () => {
    const spark = new Sprite(pixelTexture("star"));
    spark.anchor.set(0.5);
    spark.scale.set(3);
    spark.tint = [C.amber, C.magenta, C.ink][Math.floor(Math.random() * 3)];
    spark.position.set(W / 2, H / 2 - 120);
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 8;
    spark.vx = Math.cos(angle) * speed;
    spark.vy = Math.sin(angle) * speed;
    spark.spin = 0.1;
    return spark;
  });

  runScene(
    layers.takeover,
    scene,
    3200,
    (progress, elapsed, delta) => {
      dim.alpha = Math.min(progress * 4, 0.75) * (progress > 0.85 ? (1 - progress) / 0.15 : 1);
      banner.scale.set(Math.min(elapsed / 220, 1) * (1 + Math.sin(elapsed / 160) * 0.06));
      banner.y = H / 2 - 60 + Math.sin(elapsed / 200) * 18;
      caption.alpha = Math.min(elapsed / 400, 1);
      credit.alpha = Math.min(elapsed / 400, 1);
      trophy.rotation = Math.sin(elapsed / 260) * 0.25;
      trophy.y = H / 2 - 240 + Math.sin(elapsed / 180) * 14;
      stepParticles(confetti, delta, 0.12);
      stepParticles(fireworks, delta, 0.1);
      for (const spark of fireworks) spark.alpha = 1 - progress;
    },
    done,
  );
}

/** review-approved: a stamp slamming down inside an expanding shockwave ring. */
function approvedTakeover(event, done) {
  const { scene, dim, banner, caption, credit } = takeoverScene(
    "APPROVED!",
    C.green,
    event,
    "approved by",
  );
  banner.y = H / 2 - 40;

  const ring = new Sprite(ringTexture());
  ring.anchor.set(0.5);
  ring.tint = C.green;
  ring.position.set(W / 2, H / 2 - 40);
  scene.addChildAt(ring, 1);

  const stamp = pixelSprite("check", 20, C.green);
  stamp.position.set(W / 2, H / 2 - 250);
  scene.addChild(stamp);

  const sparks = particles(scene, 48, () => {
    const spark = new Sprite(pixelTexture("star"));
    spark.anchor.set(0.5);
    spark.scale.set(2.5);
    spark.tint = C.green;
    spark.position.set(W / 2, H / 2 - 40);
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 6;
    spark.vx = Math.cos(angle) * speed;
    spark.vy = Math.sin(angle) * speed;
    spark.spin = 0.05;
    return spark;
  });

  runScene(
    layers.takeover,
    scene,
    2400,
    (progress, elapsed, delta) => {
      dim.alpha = Math.min(progress * 5, 0.7) * (progress > 0.85 ? (1 - progress) / 0.15 : 1);
      // The stamp drops fast, overshoots, settles.
      const drop = Math.min(elapsed / 320, 1);
      stamp.scale.set(24 - 12 * drop + Math.sin(drop * Math.PI) * 4);
      stamp.alpha = drop;
      banner.scale.set(drop < 1 ? drop * 0.9 : 1 + Math.sin(elapsed / 150) * 0.04);
      caption.alpha = Math.min(elapsed / 400, 1);
      credit.alpha = Math.min(elapsed / 400, 1);
      ring.scale.set(1 + progress * 34);
      ring.alpha = Math.max(0, 0.9 - progress * 1.2);
      stepParticles(sparks, delta, 0.06);
      for (const spark of sparks) spark.alpha = 1 - progress;
    },
    done,
  );
}

// --------------------------------------------------------------------------------
// Ambient animations: small, silent, one per event type, allowed to overlap.
// --------------------------------------------------------------------------------

// ponytail: at most 6 ambient scenes at once — a burst of comments should not turn
// into a screen full of sprites. Extra events still land in the Feed.
let ambientLive = 0;

function ambientScene(container, duration, update) {
  if (ambientLive >= 6) {
    container.destroy({ children: true });
    return;
  }
  ambientLive++;
  runScene(layers.fx, container, duration, update, () => ambientLive--);
}

/** pr-opened: a rocket flies in from the left and docks on the In Flight panel. */
function prOpenedAnimation() {
  const scene = new Container();
  const rocket = pixelSprite("rocket", 10);
  rocket.position.set(-80, 700);
  scene.addChild(rocket);
  const trail = particles(scene, 12, () => {
    const puff = new Sprite(dotTexture());
    puff.anchor.set(0.5);
    puff.scale.set(5);
    puff.tint = C.orange;
    puff.alpha = 0;
    puff.vx = 0;
    puff.vy = 0;
    puff.spin = 0;
    return puff;
  });
  ambientScene(scene, 1600, (progress, elapsed) => {
    rocket.x = -80 + progress * (1552 + 80);
    rocket.y = 700 - progress * 300 + Math.sin(elapsed / 120) * 12;
    rocket.alpha = progress > 0.85 ? (1 - progress) / 0.15 : 1;
    const puff = trail[Math.floor(elapsed / 90) % trail.length];
    puff.position.set(rocket.x - 40, rocket.y + 6);
    puff.alpha = 0.7;
    for (const smoke of trail) smoke.alpha *= 0.94;
  });
}

/** pr-closed: the PR's crate tips off the In Flight wall and falls away. */
function prClosedAnimation() {
  const scene = new Container();
  const crate = pixelSprite("crate", 9, C.red);
  crate.position.set(1540, 320);
  scene.addChild(crate);
  ambientScene(scene, 1400, (progress, elapsed) => {
    crate.x = 1540 + progress * 60;
    crate.y = 320 + progress * progress * 900;
    crate.rotation = progress * 3;
    crate.alpha = 1 - progress * 0.6;
  });
}

/** changes-requested: a red bang shakes over the Feed and the panel edge flashes. */
function changesRequestedAnimation() {
  const scene = new Container();
  const flash = new Graphics()
    .roundRect(24, 204, 1160, 852, 10)
    .stroke({ width: 6, color: C.red });
  scene.addChild(flash);
  const bang = pixelSprite("bang", 12);
  bang.position.set(1060, 480);
  scene.addChild(bang);
  ambientScene(scene, 1200, (progress, elapsed) => {
    const shake = Math.sin(elapsed / 40) * 14 * (1 - progress);
    bang.x = 1060 + shake;
    bang.rotation = shake / 120;
    flash.alpha = Math.abs(Math.sin(elapsed / 110)) * (1 - progress);
    bang.alpha = 1 - progress * 0.5;
  });
}

/** pr-comment: a speech bubble pops off the newest Feed row and drifts up. */
function prCommentAnimation() {
  const scene = new Container();
  const bubble = pixelSprite("bubble", 8);
  bubble.position.set(300, 500);
  scene.addChild(bubble);
  ambientScene(scene, 1200, (progress, elapsed) => {
    bubble.y = 500 - progress * 180;
    bubble.x = 300 + Math.sin(elapsed / 180) * 24;
    bubble.scale.set(8 * Math.min(elapsed / 160, 1));
    bubble.alpha = 1 - progress ** 2;
  });
}

const AMBIENT = {
  "pr-opened": prOpenedAnimation,
  "pr-closed": prClosedAnimation,
  "changes-requested": changesRequestedAnimation,
  "pr-comment": prCommentAnimation,
};
const ambient = (type) => AMBIENT[type]?.();

/** Day Chime: a banner sweeps across the marquee line and the bell plays. */
function chime(at = "") {
  play("day-chime");
  const scene = new Container();
  // The board talks to the whole team, not to a single player at a cabinet.
  const text =
    at === "17:00"
      ? `${at}  GAME OVER — GREAT RUN TEAM`
      : `${at}  GOOD MORNING TEAM — PRESS START`;
  const banner = label(text, 54, C.magenta, {
    dropShadow: { color: 0x000000, distance: 4, blur: 0, angle: Math.PI / 4, alpha: 1 },
  });
  banner.anchor.set(0.5);
  banner.position.set(W / 2, H / 2);
  const backing = new Sprite(dotTexture());
  backing.anchor.set(0.5);
  backing.width = W;
  backing.height = 140;
  backing.tint = 0x000000;
  backing.alpha = 0.75;
  backing.position.set(W / 2, H / 2);
  scene.addChild(backing, banner);
  ambientScene(scene, 2600, (progress) => {
    const fade = progress < 0.15 ? progress / 0.15 : progress > 0.8 ? (1 - progress) / 0.2 : 1;
    scene.alpha = fade;
    banner.scale.set(0.9 + fade * 0.1);
  });
}

// --------------------------------------------------------------------------------
// The heartbeat: bulbs, roll band, blinking prompt, score tick-up. One ticker for
// the whole client — scenes add and remove their own callbacks on this same ticker.
// --------------------------------------------------------------------------------

let phase = 0;
app.ticker.add((ticker) => {
  phase += ticker.deltaMS;
  const chase = phase / 90;
  for (let i = 0; i < bulbs.length; i++)
    bulbs[i].alpha = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(chase - i * 0.5));
  rollBand.y = ((rollBand.y + ticker.deltaTime * 1.6) % (H + 200)) - 100;
  insertCoin.alpha = Math.floor(phase / 600) % 2 ? 0.25 : 1;

  // Count toward the real score in steps rather than re-rasterising the digits every
  // frame; ~25 updates is enough to read as a tick-up.
  if (scoreShown !== scoreTarget) {
    scoreClock += ticker.deltaMS;
    if (scoreClock >= 40) {
      scoreClock = 0;
      scoreShown = Math.min(
        scoreTarget,
        scoreShown + Math.max(1, Math.ceil((scoreTarget - scoreShown) / 12)),
      );
      drawScore();
      scoreDisplay.scale.set(1.12);
      scoreDisplay.style.fill = C.white;
    }
  } else if (scoreDisplay.scale.x !== 1) {
    scoreDisplay.scale.set(1);
    scoreDisplay.style.fill = C.amber;
  }
});

// --------------------------------------------------------------------------------
// Display protocol (server -> client only):
//   {type:"snapshot", feed:[{<domain event>, at}], teamScore,
//    openPrs:[{repo,number,title,actor}]}  (openPrs.actor is the PR's author)
//   on connect and whenever the score or the in-flight list moves, then bare domain
//   events {type, repo, number, title, actor}; actor is the GitHub login of whoever
//   did it (merger, reviewer, commenter), always a string and "" when GitHub named
//   nobody. Celebration Events carry audible:true|false (Quiet Hours), and
//   {type:"day-chime", at:"HH:MM"} marks the start and end of the workday.
// --------------------------------------------------------------------------------

function handleMessage(data) {
  if (data.type === "day-chime") {
    chime(data.at ?? "");
    return;
  }
  if (data.type === "snapshot") {
    feed = data.feed.map(stamp);
    setScore(data.teamScore);
    renderFlight(data.openPrs);
  } else {
    feed.push(stamp(data));
    if (CELEBRATIONS.has(data.type)) celebrate(data.type, data, Boolean(data.audible));
    else ambient(data.type);
  }
  renderFeed();
}

let backoff = 500;
function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}`);

  socket.addEventListener("open", () => {
    backoff = 500;
  });

  socket.addEventListener("message", (message) => handleMessage(JSON.parse(message.data)));

  // The TV has no keyboard, so it has to recover from a dropped socket alone.
  socket.addEventListener("close", () => {
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 10_000);
  });
}
connect();

renderFeed();
renderFlight([]);

// Visual QA hook: the canvas can only be checked by a human, so every animation and
// every sound can be fired from the browser console.
//   arcade.demo()                      — one of everything, in order
//   arcade.event({type:"pr-merged", repo:"a/b", number:7, title:"x", audible:true})
//   arcade.celebrate("review-approved") / arcade.ambient("pr-comment") / arcade.chime("09:00")
//   arcade.play("pr-merged")           — sound only
//   arcade.setScore(1234)              — marquee tick-up
const sample = (type) => ({
  type,
  repo: "nextworkengineering/demo",
  number: 42,
  title: "Demo pull request",
  actor: "brandon-nextwork",
});
window.arcade = {
  app, // arcade.app.ticker.stop() / .update(t) steps an animation frame by frame
  celebrate: (type = "pr-merged", audible = true) => celebrate(type, sample(type), audible),
  ambient,
  chime,
  play,
  setScore,
  event: handleMessage,
  demo() {
    ["pr-opened", "pr-comment", "changes-requested", "pr-closed"].forEach((type, i) =>
      setTimeout(() => ambient(type), i * 1600),
    );
    setTimeout(() => setScore(scoreTarget + 125), 6400);
    setTimeout(() => window.arcade.celebrate("pr-merged"), 6600);
    setTimeout(() => window.arcade.celebrate("review-approved"), 6800);
    setTimeout(() => chime("09:00"), 13_000);
  },
};
