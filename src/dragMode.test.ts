import { test } from "node:test";
import assert from "node:assert/strict";

import { DRAG_MODE_NOTICE_MS, dragModeNotice, shouldExplainDragMode } from "./dragMode.ts";
import { t } from "./i18n.ts";

test("turning the mode on is explained the first time", () => {
	assert.equal(shouldExplainDragMode(true, false), true);
});

test("turning it on again is not news", () => {
	// The notice fades on its own, so "has it been seen" has to be what was
	// written down rather than what is on screen.
	assert.equal(shouldExplainDragMode(true, true), false);
});

test("turning it off says nothing", () => {
	assert.equal(shouldExplainDragMode(false, false), false);
	assert.equal(shouldExplainDragMode(false, true), false);
});

test("the notice is words a person can read, in both languages", () => {
	// It is a `Notice`, so it carries no markup, and it has to name the gesture
	// it changed rather than the setting it lives under.
	const text = dragModeNotice();
	assert.equal(text, t("main.notice.dragMode"));
	assert.ok(text.length > 40);
	for (const mark of ["**", "`", "[", "]"]) {
		assert.equal(text.includes(mark), false, `a Notice is plain text, not ${mark}`);
	}
	assert.ok(DRAG_MODE_NOTICE_MS >= 8000, "long enough to read a sentence twice");
});
