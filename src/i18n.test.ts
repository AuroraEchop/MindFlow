import { test } from "node:test";
import assert from "node:assert/strict";

import {
	DICTIONARIES,
	detectLanguage,
	getLanguage,
	normalizeLanguage,
	resolveLanguage,
	setLanguage,
	t,
} from "./i18n.ts";
import type { I18nKey, Language } from "./i18n.ts";

/** Runs `body` with `globalThis.localStorage` swapped for a stand-in. */
function withStorage(value: string | null, body: () => void): void {
	const host = globalThis as { localStorage?: unknown };
	const had = "localStorage" in host;
	const before = host.localStorage;
	host.localStorage = { getItem: (key: string) => (key === "language" ? value : null) };
	try {
		body();
	} finally {
		if (had) host.localStorage = before;
		else delete host.localStorage;
	}
}

// --- the tables ----------------------------------------------------------------

test("both languages carry exactly the same keys", () => {
	assert.deepEqual(Object.keys(DICTIONARIES.zh).sort(), Object.keys(DICTIONARIES.en).sort());
});

test("no language leaves a word blank", () => {
	for (const [language, table] of Object.entries(DICTIONARIES)) {
		for (const [key, value] of Object.entries(table)) {
			assert.notEqual(value.trim(), "", `${language}:${key}`);
		}
	}
});

test("the two languages actually differ, so a copy-paste is not mistaken for a translation", () => {
	const en = DICTIONARIES.en;
	const zh = DICTIONARIES.zh;
	const same = (Object.keys(en) as I18nKey[]).filter((key) => en[key] === zh[key]);
	// A handful of keys are legitimately identical -- "English", "Tab", a
	// language name -- but the bulk of the table must have been translated.
	assert.ok(same.length < 10, `${same.length} keys are untranslated: ${same.join(", ")}`);
});

// --- reading a language tag ----------------------------------------------------

test("a language tag is read down to the two the plugin has words for", () => {
	assert.equal(normalizeLanguage("en"), "en");
	assert.equal(normalizeLanguage("en-GB"), "en");
	assert.equal(normalizeLanguage("zh"), "zh");
	assert.equal(normalizeLanguage("zh-TW"), "zh");
	assert.equal(normalizeLanguage("zh-Hans"), "zh");
	assert.equal(normalizeLanguage("ZH"), "zh");
	assert.equal(normalizeLanguage("fr"), "en");
});

test("nothing at all reads as the fallback rather than as a crash", () => {
	assert.equal(normalizeLanguage(null), "en");
	assert.equal(normalizeLanguage(undefined), "en");
	assert.equal(normalizeLanguage(""), "en");
	assert.equal(normalizeLanguage("   "), "en");
});

test("auto asks Obsidian, and a pinned preference does not", () => {
	withStorage("zh", () => {
		assert.equal(detectLanguage(), "zh");
		assert.equal(resolveLanguage("auto"), "zh");
		assert.equal(resolveLanguage("en"), "en");
		assert.equal(resolveLanguage("zh"), "zh");
	});

	withStorage("en", () => {
		assert.equal(detectLanguage(), "en");
		assert.equal(resolveLanguage("auto"), "en");
		assert.equal(resolveLanguage("zh"), "zh");
	});
});

test("a missing or unreadable store falls back instead of throwing", () => {
	const host = globalThis as { localStorage?: unknown };
	const had = "localStorage" in host;
	const before = host.localStorage;
	delete host.localStorage;
	try {
		assert.equal(detectLanguage(), "en");
	} finally {
		if (had) host.localStorage = before;
	}

	host.localStorage = {
		getItem: () => {
			throw new Error("storage is blocked");
		},
	};
	try {
		assert.equal(detectLanguage(), "en");
	} finally {
		if (had) host.localStorage = before;
		else delete host.localStorage;
	}
});

// --- saying something ----------------------------------------------------------

test("the words follow whatever language was set last", () => {
	const before = getLanguage();
	try {
		setLanguage("en");
		assert.equal(t("settings.group.structure"), "Structure");
		assert.equal(t("shortcut.undo.name"), "Undo");

		setLanguage("zh");
		assert.equal(t("settings.group.structure"), "结构");
		assert.equal(t("shortcut.undo.name"), "撤销");
	} finally {
		setLanguage(before);
	}
});

test("a placeholder is filled in, and an unknown one is left standing", () => {
	setLanguage("en");
	assert.equal(
		t("settings.shortcut.conflict", { actions: "Undo, Redo" }),
		"Also bound to Undo, Redo — the one listed first is the one that answers.",
	);
	// No params at all leaves the braces, which is what a caller that forgot
	// them should see rather than an empty sentence.
	assert.equal(t("settings.shortcut.conflict").includes("{actions}"), true);
	// A placeholder with no value keeps its braces rather than printing `undefined`.
	assert.equal(t("settings.shortcut.conflict", { other: "x" }).includes("{actions}"), true);
});

test("a key missing from the active table still says something", () => {
	const before = getLanguage();
	try {
		setLanguage("zh");
		// A row the Chinese table never learned about would fall through to
		// English; the types make that unreachable, so this stands in for a
		// hand-edited table.
		const table = DICTIONARIES.zh as Record<string, string>;
		const saved = table["shortcut.undo.name"];
		delete table["shortcut.undo.name"];
		try {
			assert.equal(t("shortcut.undo.name"), "Undo");
		} finally {
			table["shortcut.undo.name"] = saved;
		}
	} finally {
		setLanguage(before);
	}
});

test("every key resolves to a word in both languages", () => {
	const before = getLanguage();
	try {
		for (const language of ["en", "zh"] as Language[]) {
			setLanguage(language);
			for (const key of Object.keys(DICTIONARIES.en) as I18nKey[]) {
				const value = t(key);
				assert.notEqual(value, "", `${language}:${key}`);
				assert.notEqual(value, key, `${language}:${key} fell through to the key`);
			}
		}
	} finally {
		setLanguage(before);
	}
});
