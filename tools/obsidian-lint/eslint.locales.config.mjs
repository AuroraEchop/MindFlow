/**
 * The same rules, plus the ones that only apply to an English locale file.
 *
 * `recommendedWithLocalesEn` adds a group of checks that want a locale file to
 * look at -- the kind of thing a plugin that ships `en.json` needs and a plugin
 * that keeps its strings in `src/i18n.ts` mostly does not. It is here because
 * the review runs it, so a submission should be able to see what it would say.
 *
 * Run it through `npm run lint:obsidian:locales`.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

/** The plugin root, two levels up from this file. */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig([
	...obsidianmd.configs.recommendedWithLocalesEn,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parserOptions: {
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
