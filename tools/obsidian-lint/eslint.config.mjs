/**
 * Obsidian's own review rules, over the plugin's sources.
 *
 * This is not the plugin's build config and never runs as part of one. It is
 * the rule set the community-plugin review applies to a submission, which is a
 * different question from "does it compile" -- `no-static-styles-assignment`
 * and `no-console` are Errors there and perfectly valid TypeScript here.
 *
 * Run it through `npm run lint:obsidian`, never directly: ESLint has to start
 * with the plugin root as its working directory, because the rules read
 * `manifest.json` relative to the process.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

/** The plugin root, two levels up from this file. */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig([
	...obsidianmd.configs.recommended,
	{
		// Only the plugin's own TypeScript. The built bundle, the vendored
		// `node_modules`, this tools directory and the test vault are not what
		// gets reviewed.
		files: ["**/*.ts"],
		languageOptions: {
			parserOptions: {
				// The recommended set includes type-checked rules, which need to
				// know which project a file belongs to. `allowDefaultProject`
				// covers the files no tsconfig lists.
				projectService: { allowDefaultProject: ["eslint.config.*"] },
				tsconfigRootDir: ROOT,
			},
		},
	},
	{
		ignores: [
			// The review reads the plugin, not its tests. Linting them too buries
			// the four findings that matter under five hundred that do not --
			// `node:test` hands back a promise nobody awaits, and a test file
			// importing `node:fs` is not a plugin importing Node.
			"**/*.test.ts",
			"main.js",
			"node_modules/**",
			"tools/**",
			"assets/**",
			"test-vault/**",
			"*.mjs",
		],
	},
]);
