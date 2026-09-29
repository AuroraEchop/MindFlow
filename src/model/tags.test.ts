import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMarkdown } from "./parse.ts";
import { hasTag, normaliseTag, tagFilterKeys, tagsIn } from "./tags.ts";

const NOTE = `# Root

- 跨域通信 #work/urgent
	- 离线存储 #work
- 随便写写 #idea

Body paragraph carrying #work in it.

## Later

- nothing here
`;

const doc = parseMarkdown(NOTE, { title: "Untitled" });

/** Keys the filter keeps, as the note writes them. */
function kept(tags: string[]): string[] {
	const keys = tagFilterKeys(doc.root, tags, (node) =>
		node.bodyRanges
			.map(([start, end]) => doc.doc.lines.slice(start, end + 1).join("\n"))
			.join("\n"),
	);
	return [...keys].sort();
}

test("a tag is read without its `#` and without its case", () => {
	assert.deepEqual(tagsIn("a #Work and #work/todo and not #42"), ["work", "work/todo"]);
	assert.equal(normaliseTag("#Work"), "work");
	assert.equal(normaliseTag("  Work "), "work");
	// `#42` is a number, which is the rule Obsidian uses, and `C#` is glue.
	assert.deepEqual(tagsIn("#42 C# a#b"), []);
});

test("a nested tag answers to the tag above it", () => {
	// `#work/todo` lives under `#work`, the way Obsidian's own tag pane reads
	// it: a filter for `#work` that left `#work/todo` behind would be a filter
	// nobody asked for.
	assert.equal(hasTag("x #work/todo", "work"), true);
	assert.equal(hasTag("x #work", "work/todo"), false);
	assert.equal(hasTag("x #working", "work"), false);
});

test("no tags means no filter, and an empty set rather than a full one", () => {
	assert.deepEqual(tagFilterKeys(doc.root, []), new Set());
	// A tag nobody wrote filters everything out, which is the honest answer:
	// nothing on this note carries it.
	assert.deepEqual(tagFilterKeys(doc.root, ["nothing"]), new Set());
});

test("a card carrying the tag stays, and so does the branch above it", () => {
	const keys = kept(["idea"]);
	assert.ok(keys.length >= 2, "expected the card and its branch");
	// The match itself...
	assert.ok(keys.some((key) => doc.byKey.get(key)?.text.includes("#idea")));
	// ...and the root it hangs under, because a match with its branch faded
	// out is a match with nothing around it.
	assert.ok(keys.includes(doc.root.key));
	// A card that does not carry it and has nothing under it that does is out.
	assert.ok(!keys.some((key) => doc.byKey.get(key)?.text.includes("nothing here")));
});

test("a tag in a paragraph counts, because the card that draws it is on the map", () => {
	// The paragraph belongs to the root, so `#work` keeps the root -- and
	// `#work/urgent` in a list item is a nested tag of the same one.
	const byIdea = kept(["idea"]);
	const byWork = kept(["work"]);
	assert.ok(byWork.length > byIdea.length - 2);
	assert.ok(byWork.includes(doc.root.key));
});

test("two tags keep every card carrying either, which is what narrowing means", () => {
	const idea = kept(["idea"]);
	const work = kept(["work"]);
	const both = kept(["idea", "work"]);
	for (const key of [...idea, ...work]) assert.ok(both.includes(key), `${key} went`);
});
