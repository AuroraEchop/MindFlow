#!/usr/bin/env node
/**
 * Obsidian's review rules, run over the plugin's sources.
 *
 * The rules live in `eslint-plugin-obsidianmd`, which is deliberately **not** a
 * dependency of the plugin. It exists to check a submission, not to build one:
 * it pulls a second ESLint and a handful of other linters behind it, and
 * putting all of that in the plugin's `package.json` would put it in the way of
 * everybody who only wants to compile the map. So it has its own manifest and
 * its own `node_modules` under `tools/obsidian-lint/`, and this is what runs it.
 *
 * ESLint is started with the plugin root as its working directory on purpose:
 * the rules read `manifest.json` relative to the process, and a config that
 * cannot find the manifest cannot tell which rules apply to this plugin.
 *
 * `--locales` swaps in the config that also carries the English-locale checks.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tools = join(root, "tools", "obsidian-lint");
const eslint = join(tools, "node_modules", "eslint", "bin", "eslint.js");

if (!existsSync(eslint)) {
	process.stderr.write(
		"lint:obsidian keeps its own dependencies, and they are not installed yet.\n" +
			"Install them once with:\n\n" +
			"    npm --prefix tools/obsidian-lint install\n\n",
	);
	process.exit(2);
}

const locales = process.argv.includes("--locales");
const config = join(tools, locales ? "eslint.locales.config.mjs" : "eslint.config.mjs");

const run = spawnSync(process.execPath, [eslint, "--config", config, "src"], {
	cwd: root,
	stdio: "inherit",
});

if (run.error) {
	process.stderr.write(`${run.error.message}\n`);
	process.exit(1);
}
process.exit(run.status ?? 1);
