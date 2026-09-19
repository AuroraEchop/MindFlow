import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DRAWN_PALETTES, PALETTES } from "./palette.ts";

/**
 * A palette is a name in two places -- the list the settings tab offers, and
 * the attribute the stylesheet keys on -- and nothing but this test ties them
 * together. It was written because the two had already drifted apart once: the
 * `theme` rule was in `styles.css` with nothing anywhere writing the attribute,
 * so choosing the palette changed nothing at all.
 */
const CSS = readFileSync(
	fileURLToPath(new URL("../../styles.css", import.meta.url)),
	"utf8",
);

/** The body of one rule, as written. */
function rule(selector: string): string {
	const at = CSS.indexOf(`${selector} {`);
	assert.notEqual(at, -1, `${selector} is not in styles.css any more`);
	return CSS.slice(at + selector.length + 2, CSS.indexOf("}", at));
}

test("every palette but the default has a rule of its own", () => {
	for (const palette of DRAWN_PALETTES) {
		assert.ok(
			CSS.includes(`.mm-content[data-palette="${palette}"]`),
			`styles.css has no rule for the "${palette}" palette`,
		);
	}
});

test("the default is the absence of the attribute, so it has no rule", () => {
	// A map drawn before the setting existed carries no attribute at all, and
	// it has to come out looking the way `classic` does.
	assert.ok(PALETTES.includes("classic"));
	assert.ok(!DRAWN_PALETTES.includes("classic"));
	assert.ok(!CSS.includes('.mm-content[data-palette="classic"]'));
});

test("a drawn palette names all ten hues", () => {
	// Nine of them would leave one branch drawing whatever `--mm-b9` inherited
	// from the view root, which is the classic colour in a palette that is
	// supposed to be following the theme.
	for (const palette of DRAWN_PALETTES) {
		const body = rule(`.mm-content[data-palette="${palette}"]`);
		for (let i = 0; i < 10; i++) {
			assert.ok(body.includes(`--mm-b${i}:`), `--mm-b${i} is not set by "${palette}"`);
		}
	}
});

test("every palette a rule names is one the setting offers", () => {
	for (const match of CSS.matchAll(/\.mm-content\[data-palette="([^"]+)"\]/g)) {
		assert.ok(
			PALETTES.includes(match[1] as (typeof PALETTES)[number]),
			`styles.css draws a "${match[1]}" palette the setting cannot offer`,
		);
	}
});
