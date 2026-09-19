import esbuild from "esbuild";
import process from "node:process";
// Node's own list, rather than the `builtin-modules` package: one less
// dependency, and it cannot fall behind the runtime it is describing.
import { builtinModules } from "node:module";

const banner = `/*
MindFlow — https://github.com/AuroraEchop/MindFlow
Copyright (c) 2026 AuroraEchop. MIT licensed.

This is a generated file. Source lives in src/.
*/
`;

const production = process.argv[2] === "production";

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`),
  ],
  format: "cjs",
  // Kept in step with tsconfig's `target`. The sources already use ES2022
  // spellings (`.at()`, `replaceChildren`), so an older target here would only
  // mislead a reader -- esbuild does not polyfill either way.
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: production,
});

if (production) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
