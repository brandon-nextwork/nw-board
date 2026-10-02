// The Neobrutal Theme: the kernel's accents on a canary ground — white slabs, ink
// outlines, hard unblurred shadows, sticker chips. Kernel tokens wherever one
// matches exactly; pink has no kernel token, so it is the one raw color here.
import { KERNEL } from "../kernel-tokens.gen.js";

const INK = KERNEL["brand-950"];
const PINK = 0xff90e8;

// Archivo Black carries headings and display (>=34px: panel headings, clock, MVP,
// stat values, takeovers); Space Grotesk 700 everything smaller, ticker included.
// fonts.css declares Archivo Black at 700, so one weight serves both faces.
const FONT_UI = '"Space Grotesk", system-ui, sans-serif';
const FONT_DISPLAY = '"Archivo Black", "Space Grotesk", system-ui, sans-serif';

const palette = {
  bg: KERNEL["accent-canary"],
  panel: KERNEL["white"],
  // The marquee slab: the NextWork lockup is on-dark only.
  panelDeep: INK,
  panelEdge: INK,
  ink: INK,
  dim: KERNEL["brand-600"],
  amber: KERNEL["accent-canary"],
  green: KERNEL["accent-emerald"],
  red: KERNEL["error-500"],
  magenta: KERNEL["accent-plum"],
  orange: KERNEL["accent-pumpkin"],
  info: KERNEL["accent-cornflower"],
  white: KERNEL["white"],
  marqueeEdge: INK,
  // Only the typed marquee title (a missing logo) wears it, on the ink slab; the
  // chime's headline sits on the white card in ink instead.
  heroInk: KERNEL["white"],
  pixelDim: KERNEL["brand-600"],
  titleShadow: INK,
  scanline: INK,
  // No CRT here: the ground is flat print.
  scanlineAlpha: 0,
  marqueeInk: KERNEL["white"],
  marqueeDim: KERNEL["accent-canary"],
  // Titles on white panels read in full ink, not muted.
  feedTitle: INK,
  // Sprites outlined in ink, not the canary ground they would melt into.
  spriteOutline: INK,
};

export default {
  palette,
  type: {
    family: (fontSize) => (fontSize >= 34 ? FONT_DISPLAY : FONT_UI),
    weight: "700",
    tracking: (fontSize) => (fontSize >= 34 ? Math.round(fontSize * -0.01) : 0),
    pillTracking: undefined,
    valueTracking: undefined,
    nameMax: 12,
  },
  preload: ['700 34px "Archivo Black"', '700 24px "Space Grotesk"'],
  // Canary around a letterboxed scene, so the ground runs to the bezel.
  letterbox: "#ffdd2d",
  sprites: {},
  decorations: {
    // No starfield, grid or roll band on the canary.
    flat: true,
    // Panels, marquee and ticker: outline width and hard-shadow offset, in px.
    outline: 5,
    hardShadow: 10,
    marqueeShadow: PINK,
    tickerFill: PINK,
    // Solid header bars, each with the heading ink that reads on it.
    headers: {
      feed: { fill: KERNEL["accent-cornflower"], ink: KERNEL["white"] },
      wau: { fill: KERNEL["accent-emerald"], ink: INK },
    },
    // Event names, IN DEV, repo pills, the MVP tally and the takeover credit as
    // filled stickers. Ink text on every fill except these darker ones.
    chips: {
      whiteOn: [palette.info, palette.red, palette.magenta, palette.dim, INK],
      dev: KERNEL["accent-emerald"],
      pill: PINK,
      tally: PINK,
      credit: KERNEL["accent-emerald"],
      news: INK,
    },
    // WAU stat boxes: white, TARGET REACHED canary.
    stats: { fill: KERNEL["white"], hot: KERNEL["accent-canary"], outline: 4 },
    // Outlined bars and swatches; canary values would vanish on white, so muted.
    chart: { outline: 3, valueInk: KERNEL["brand-600"] },
    // Takeovers and Day Chimes on a tilted white card instead of a dark band.
    card: { tilt: -2, outline: 8, shadow: 18 },
  },
};
