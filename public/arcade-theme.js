// The Arcade Theme: the board's pre-reskin synthwave palette, worn from a WAU
// Target Hit until local midnight. Same keys as client.js's kernel `C`, so every
// display object built from `C` picks these up unchanged. This is the one place
// outside kernel-tokens.gen.js that may hold raw colors — they are the old look
// by definition, not kernel tokens.
export const ARCADE_C = {
  bg: 0x0b0b1a,
  panel: 0x141433,
  panelDeep: 0x1a0f2e,
  panelEdge: 0x2b2b6b,
  ink: 0x9fe8ff,
  dim: 0x5b6ba8,
  amber: 0xffe066,
  green: 0x66ddaa,
  red: 0xff5c7a,
  magenta: 0xff7ce5,
  orange: 0xff9a3c,
  info: 0x9fe8ff,
  white: 0xffffff,
  // The hero spots the kernel reskin took magenta out of: marquee border, typed
  // title, chime headline.
  marqueeEdge: 0xff7ce5,
  heroInk: 0xff7ce5,
  pixelDim: 0x3a3a6a,
  titleShadow: 0x9fe8ff,
  scanline: 0x000000,
  scanlineAlpha: 0.22,
};
