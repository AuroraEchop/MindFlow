/**
 * Replacing text across a whole note.
 *
 * Find and replace read different things on purpose, and it is worth being
 * clear about which is which.
 *
 * *Find* reads the text a reader sees: `model/search.ts` strips the markup, so
 * `**bold**` is found by "bold" and `[[note|Label]]` by "Label". *Replace*
 * reads what the note actually wrote, because that is where a replacement has
 * to land -- there is no way to put new characters into a rendering. In
 * practice the two agree on nearly everything, because what a reader sees is a
 * slice of what was written; the two cases where they do not are a phrase that
 * only exists once the markers are stripped, and a phrase that only exists
 * inside markup, and neither is a thing anybody types into a replace box.
 *
 * Only a node's own title is touched. An annotation and a text block are lines
 * the node owns rather than lines it *is*, and the find bar does not search
 * them either -- a replacement that reached further than the search did would
 * change text the user was never shown.
 *
 * Free of every import but the pure model ones, so `node --test` runs it as-is.
 */

import { replaceLine, toText } from "./lines.ts";
import { renderNodeLine, walk } from "./types.ts";
import type { MindNode, ParsedDoc } from "./types.ts";

export interface ReplaceQuery {
	text: string;
	regex: boolean;
	/** The new text. `$1` and friends only mean anything when `regex` is on. */
	replacement: string;
}

/** One node whose line would change, and what it would become. */
export interface ReplaceEdit {
	id: string;
	key: string;
	/** Line the node is written on, for the caller's focus. */
	line: number;
	before: string;
	after: string;
	/** Occurrences inside this one title. */
	hits: number;
}

export interface ReplacePlan {
	edits: ReplaceEdit[];
	/** Occurrences across every edit, not nodes: one title may hold several. */
	count: number;
	/** True when `regex` was on and the pattern would not compile. */
	invalid: boolean;
}

const EMPTY: ReplacePlan = { edits: [], count: 0, invalid: false };

/**
 * Every non-overlapping occurrence of `needle`, replaced with `replacement`.
 *
 * The replacement goes in verbatim, `$` and all: with the literal mode there
 * are no capture groups for a `$1` to refer to, and quietly eating one would
 * lose characters the user typed.
 */
function replaceLiteral(
	text: string,
	needle: string,
	replacement: string,
): { text: string; hits: number } {
	const haystack = text.toLowerCase();
	const find = needle.toLowerCase();
	let out = "";
	let hits = 0;
	let from = 0;
	for (;;) {
		const at = haystack.indexOf(find, from);
		if (at < 0) break;
		out += text.slice(from, at) + replacement;
		from = at + needle.length;
		hits++;
	}
	if (hits === 0) return { text, hits: 0 };
	return { text: out + text.slice(from), hits };
}

/**
 * The same, with the pattern's own backreferences left to `String.replace`.
 *
 * The occurrences are counted by a first pass rather than by a replacement
 * function, because a function replacement would turn `$1` into the two
 * characters it is spelled with. `lastIndex` is re-aimed before each pass: the
 * pattern is shared and global, so what it holds is whatever the node before
 * this one left there.
 */
function replaceByRegex(
	text: string,
	re: RegExp,
	replacement: string,
): { text: string; hits: number } {
	re.lastIndex = 0;
	const found = text.match(re);
	if (found === null) return { text, hits: 0 };
	re.lastIndex = 0;
	return { text: text.replace(re, replacement), hits: found.length };
}

/** A global, case-insensitive matcher for the query, or null when it is broken. */
function matcherFor(query: ReplaceQuery): RegExp | null | undefined {
	if (!query.regex) return undefined;
	try {
		return new RegExp(query.text, "gi");
	} catch {
		// A pattern is incomplete for as long as it is being typed, which is
		// the normal case rather than something to report.
		return null;
	}
}

/**
 * What a replace would change, without changing it.
 *
 * Separate from the write so the count can be shown before anything is
 * touched, and so the whole decision is testable without a document.
 */
export function planReplace(root: MindNode, query: ReplaceQuery): ReplacePlan {
	if (query.text === "") return EMPTY;
	const re = matcherFor(query);
	if (re === null) return { edits: [], count: 0, invalid: true };

	const edits: ReplaceEdit[] = [];
	let count = 0;

	walk(root, (node) => {
		// A virtual root stands for the filename and owns no line, and a body
		// card is a line the node owns rather than one it is.
		if (node.virtual || node.kind === "body" || node.lineStart < 0) return;
		const before = node.text;
		const result = re === undefined
			? replaceLiteral(before, query.text, query.replacement)
			: replaceByRegex(before, re, query.replacement);
		if (result.hits === 0) return;
		edits.push({
			id: node.id,
			key: node.key,
			line: node.lineStart,
			before,
			after: result.text,
			hits: result.hits,
		});
		count += result.hits;
	});

	return { edits, count, invalid: false };
}

/** What a replace did, in the shape the view's write path already speaks. */
export interface ReplaceResult {
	text: string;
	focusLine: number;
	ok: boolean;
	/** Occurrences replaced, 0 when nothing was. */
	count: number;
}

/** A refusal that still hands back the document it was given. */
function nothing(parsed: ParsedDoc): ReplaceResult {
	return { text: toText(parsed.doc), focusLine: -1, ok: false, count: 0 };
}

/**
 * Plan a replace and write it, in one pass over the document.
 *
 * Every changed line is rewritten in a single `LineDoc`, so the whole thing
 * reaches the file as one edit and comes back as one undo step -- a hundred
 * replacements should not be a hundred presses of Ctrl+Z.
 *
 * `only` narrows the plan to a single node, which is what "replace in this
 * match" means: the bar's cursor is on a node, not on an occurrence, so the
 * unit of a targeted replace is the card the user is looking at.
 */
export function replaceInTree(
	parsed: ParsedDoc,
	query: ReplaceQuery,
	only: MindNode | null = null,
): ReplaceResult {
	const plan = planReplace(parsed.root, query);
	if (plan.invalid || plan.edits.length === 0) return nothing(parsed);

	let doc = parsed.doc;
	let first = -1;
	let count = 0;

	for (const edit of plan.edits) {
		if (only !== null && edit.id !== only.id) continue;
		const node = parsed.byId.get(edit.id);
		// A node that left the tree between the plan and the write is skipped
		// rather than guessed at.
		if (!node || node.lineStart < 0) continue;
		doc = replaceLine(doc, node.lineStart, renderNodeLine(node, edit.after));
		if (first < 0) first = node.lineStart;
		count += edit.hits;
	}

	if (count === 0) return nothing(parsed);
	return { text: toText(doc), focusLine: first, ok: true, count };
}
