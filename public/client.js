// PixiJS from CDN so there is no bundler yet; move it local before the Pi goes offline-ish.
import {
  Application,
  Container,
  Graphics,
  Text,
} from "https://cdn.jsdelivr.net/npm/pixi.js@8.6.6/dist/pixi.min.mjs";

const app = new Application();
await app.init({ background: "#101020", resizeTo: window });
document.body.appendChild(app.canvas);

const idle = new Text({
  text: "PR ARCADE",
  style: { fill: 0x445566, fontFamily: "monospace", fontSize: 32 },
});
idle.position.set(24, 24);
app.stage.addChild(idle);

// Placeholder Team Score: plain text, marquee styling comes later.
const scoreText = new Text({
  text: "TEAM SCORE 0",
  style: { fill: 0xffe066, fontFamily: "monospace", fontSize: 32 },
});
scoreText.position.set(280, 24);
app.stage.addChild(scoreText);

// Placeholder Feed: plain text lines, arcade theme comes later.
const feedText = new Text({
  text: "",
  style: { fill: 0x8899bb, fontFamily: "monospace", fontSize: 20 },
});
feedText.position.set(24, 80);
app.stage.addChild(feedText);

// Placeholder in-flight list: the currently open PRs, state rather than 24h events.
const openPrsText = new Text({
  text: "",
  style: { fill: 0x66ddaa, fontFamily: "monospace", fontSize: 20 },
});
openPrsText.position.set(24, 560);
app.stage.addChild(openPrsText);

const CELEBRATIONS = new Set(["pr-merged", "review-approved"]);
const DAY_MS = 24 * 60 * 60 * 1000;
let feed = [];

// The server only expires the Feed when it builds a snapshot, so a display left
// connected for days has to drop its own stale entries. Snapshot entries carry the
// server time they happened at; a live event is happening right now.
const stamp = (event) => ({ ...event, at: event.at ?? Date.now() });

function renderFeed() {
  feed = feed.filter((e) => Date.now() - e.at < DAY_MS);
  feedText.text = feed
    .slice(-20)
    .map((e) => `${e.type.padEnd(18)} ${e.repo} #${e.number}  ${e.title}`)
    .join("\n");
}

// An idle board still has to age entries out; a minute of granularity is plenty.
setInterval(renderFeed, 60_000);

// Placeholder sounds: square-wave oscillators standing in for the 8-bit assets.
// [frequency Hz, start seconds, length seconds] per note; a jingle stays under 3s.
const JINGLE = [
  [523, 0, 0.12],
  [659, 0.12, 0.12],
  [784, 0.24, 0.12],
  [1047, 0.36, 0.34],
];
const CHIME = [
  [880, 0, 0.35],
  [587, 0.3, 0.6],
];

// The kiosk has no user gesture to unblock audio, so Chromium is launched with
// --autoplay-policy=no-user-gesture-required. Anywhere else the context stays
// suspended (or missing) and playback is skipped rather than throwing.
let audio;
function play(notes) {
  try {
    audio ??= new AudioContext();
  } catch {
    return;
  }
  if (audio.state !== "running") return;
  for (const [frequency, start, length] of notes) {
    const at = audio.currentTime + start;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.12, at);
    // Fade each note out; a hard stop on a square wave clicks.
    gain.gain.exponentialRampToValueAtTime(0.001, at + length);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + length);
  }
}

// Protocol: {type:"snapshot", feed:[{...event, at}], teamScore:N, openPrs:[...]} on
// connect and again whenever the score or the in-flight list moves, then bare domain
// events; Celebration Events carry audible:true|false (Quiet Hours), and
// {type:"day-chime"} marks the start and end of the workday.
let backoff = 500;
function connect() {
  const socket = new WebSocket(`ws://${location.host}`);

  socket.addEventListener("open", () => {
    backoff = 500;
  });

  socket.addEventListener("message", (message) => {
    const data = JSON.parse(message.data);
    if (data.type === "day-chime") {
      play(CHIME);
      return;
    }
    if (data.type === "snapshot") {
      feed = data.feed.map(stamp);
      scoreText.text = `TEAM SCORE ${data.teamScore}`;
      openPrsText.text = [
        "IN FLIGHT",
        ...data.openPrs.map((pr) => `${pr.repo} #${pr.number}  ${pr.title}`),
      ].join("\n");
    } else {
      feed.push(stamp(data));
      if (CELEBRATIONS.has(data.type)) {
        celebrate(`${data.type.toUpperCase()}  #${data.number}  ${data.title}`);
        if (data.audible) play(JINGLE);
      }
    }
    renderFeed();
  });

  // The TV has no keyboard, so it has to recover from a dropped socket alone.
  socket.addEventListener("close", () => {
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 10_000);
  });
}
connect();

// Placeholder celebration: bouncing text + falling confetti for ~3s.
function celebrate(label) {
  const scene = new Container();
  const text = new Text({
    text: label,
    style: { fill: 0xffe066, fontFamily: "monospace", fontSize: 56 },
  });
  text.anchor.set(0.5);
  text.position.set(app.screen.width / 2, app.screen.height / 2);
  scene.addChild(text);

  const confetti = Array.from({ length: 60 }, () => {
    const piece = new Graphics()
      .rect(0, 0, 12, 12)
      .fill(Math.floor(Math.random() * 0xffffff));
    piece.position.set(Math.random() * app.screen.width, -20);
    piece.vy = 2 + Math.random() * 4;
    scene.addChild(piece);
    return piece;
  });

  app.stage.addChild(scene);
  let elapsed = 0;
  const tick = (ticker) => {
    elapsed += ticker.deltaMS;
    text.y = app.screen.height / 2 + Math.sin(elapsed / 120) * 60;
    text.scale.set(1 + Math.sin(elapsed / 200) * 0.08);
    for (const piece of confetti) {
      piece.y += piece.vy * ticker.deltaTime;
      piece.rotation += 0.1 * ticker.deltaTime;
    }
    if (elapsed > 3000) {
      app.ticker.remove(tick);
      scene.destroy({ children: true });
    }
  };
  app.ticker.add(tick);
}
