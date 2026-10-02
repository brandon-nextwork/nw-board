// Brand-kernel gates: the committed token file must match the kernel submodule,
// and no color may bypass it as a raw literal. The sanctioned exceptions are the
// non-kernel theme files in public/themes: the Arcade Theme is the pre-reskin
// palette, not kernel tokens, so its raw colors live there and nowhere else.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
// @ts-expect-error -- plain browser JS with no declarations; the shape is checked below.
import { THEMES } from "../public/themes/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("committed kernel tokens match the kernel submodule", () => {
  try {
    execFileSync("node", ["scripts/sync-kernel.mjs", "--check"], { cwd: root });
  } catch (error: any) {
    // Exit 2 is "no readable kernel submodule". The kernel is a private repo, so
    // a contributor without access cannot init it and this gate is not theirs to
    // pass — skip rather than fail them forever. Exit 1 is real drift: resync
    // and commit the regenerated file.
    if (error?.status === 2) {
      console.warn("skipping kernel sync gate: no readable kernel submodule");
      return;
    }
    throw error;
  }
});

test.each(["client.js", "themes/kernel.js"])(
  "%s carries no raw color literals outside the gen file",
  (file) => {
    const src = readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
    expect(src.match(/0x[0-9a-fA-F]{6}\b/g) ?? []).toEqual([]);
    expect(src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  },
);

test("every theme's palette defines exactly the kernel palette's keys", () => {
  const kernel = Object.keys(THEMES.kernel.palette).sort();
  expect(kernel.length).toBeGreaterThan(0);
  for (const theme of Object.values<{ palette: object }>(THEMES)) {
    expect(Object.keys(theme.palette).sort()).toEqual(kernel);
  }
});

test("every theme file is registered and has the shape client.js reads", () => {
  // The server accepts any public/themes/<name>.js; one missing from THEMES would
  // 204 on the Pi while every display ignored it.
  const files = readdirSync(new URL("../public/themes/", import.meta.url))
    .filter((file) => file.endsWith(".js") && file !== "index.js")
    .map((file) => file.slice(0, -3))
    .sort();
  expect(Object.keys(THEMES).sort()).toEqual(files);
  for (const theme of Object.values<any>(THEMES)) {
    expect(typeof theme.type.family).toBe("function");
    expect(typeof theme.type.tracking).toBe("function");
    expect(typeof theme.type.weight).toBe("string");
    expect(typeof theme.type.nameMax).toBe("number");
    expect(Array.isArray(theme.preload)).toBe(true);
    expect(typeof theme.sprites).toBe("object");
    expect(typeof theme.decorations).toBe("object");
    // The takeover card's credit sticker reads its fill and ink from `chips`.
    if (theme.decorations.card) {
      expect(Array.isArray(theme.decorations.chips?.whiteOn)).toBe(true);
      expect(theme.decorations.chips.credit).toBeDefined();
    }
  }
});

test("the index.html letterbox matches the kernel's leather token", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const gen = readFileSync(new URL("../public/kernel-tokens.gen.js", import.meta.url), "utf8");
  // Pin the hand-typed letterbox to the generated token rather than to itself,
  // so a kernel change to leather cannot leave it silently wrong.
  const leather = gen.match(/"leather":\s*0x([0-9a-f]{6})/)?.[1];
  expect(leather).toBeDefined();
  const literals = html.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  expect(literals.length).toBeGreaterThan(0);
  for (const literal of literals) expect(literal.toLowerCase()).toBe(`#${leather}`);
});
