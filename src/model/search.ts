/**
 * Finding nodes by their text.
 *
 * The tree is the source, never the DOM: a collapsed branch has no cards at all,
 * and the cards that do exist hold MathJax output rather than the note's words.
 * That makes this a pure module, which is also what lets it be tested directly.
 */

import { plainText } from "./inlineText.ts";
import { BODY_ID_MARK, walk } from "./types.ts";
import type { MindNode, ParsedDoc } from "./types.ts";

export interface SearchQuery {
	text: string;
	regex: boolean;
	/**
	 * Whether the case of a letter is part of the word.
	 *
	 * Off by default, and off is the reading a title asks for: a map of notes
	 * has `API` in one card and `api` in another, and a search that only found
	 * one of them would be a search that did not work. On is for the search
	 * that knows exactly what it is looking for.
	 */
	caseSensitive: boolean;
	/**
	 * Whether the search is narrowed to a card's own title.
	 *
	 * Off by default, and off is the whole note: a search looks through what a
	 * card says *and* what the note's prose says under it, because a word the
	 * user remembers writing is as likely to be in a paragraph as in a heading.
	 * On is the narrowing -- a card of the note's own prose is a lot of text to
	 * walk, and a reader who already knows the word is on a card's own line does
	 * not want the paragraphs that mention it as well.
	 *
	 * Replace does not follow it: a replacement lands on a card's title, which
	 * is the line the card *is*. A note-content card is lines a node owns
	 * rather than a line it is, and writing into those from a box that never
	 * showed them is not a thing this does.
	 */
	titlesOnly: boolean;
}

export interface SearchMatch {
	key: string;
	id: string;
	/** The projection that matched, as a reader sees it on the card. */
	text: string;
}

export interface SearchResult {
	matches: SearchMatch[];
	/** True when `regex` was on and the pattern would not compile. */
	invalid: boolean;
}

/** Where in a string the query was found: `[start, end)`, in code units. */
export interface HitRange {
	start: number;
	end: number;
}

export interface SearchMatcher {
	/** Every occurrence in `text`, left to right, none of them empty. */
	ranges(text: string): HitRange[];
	/** True when `regex` was on and the pattern would not compile. */
	invalid: boolean;
}

/**
 * Every character a regex would read as syntax, escaped.
 *
 * A plain query is a *substring*, not a pattern: searching for `a.b` must find
 * the literal three characters, and `(` must be a bracket rather than a broken
 * group. Compiling the needle as a pattern is how one matcher serves both modes
 * and still hands back offsets.
 */
function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * One query, ready to be asked about any number of strings.
 *
 * Compiled once per search rather than once per card: a note of three hundred
 * cards is three hundred questions, and the answers have to be the same answer.
 * The regex is built with `g` and only ever read through `matchAll`, which does
 * not disturb the pattern's own `lastIndex` -- the reason `searchTree` used to
 * keep a flagless copy.
 */
export function compileQuery(query: SearchQuery): SearchMatcher {
	if (query.text === "") return { ranges: () => [], invalid: false };
	const flags = query.caseSensitive ? "g" : "gi";
	const source = query.regex ? query.text : escapeRegExp(query.text);
	let re: RegExp;
	try {
		re = new RegExp(source, flags);
	} catch {
		// A pattern is incomplete for as long as it is being typed, so this is
		// the normal case, not an error to report.
		return { ranges: () => [], invalid: true };
	}
	return {
		invalid: false,
		ranges: (text) => {
			const out: HitRange[] = [];
			if (text === "") return out;
			for (const m of text.matchAll(re)) {
				// A pattern that can match nothing (`a*`, `^`) would otherwise
				// hand back an empty span, and an empty span is not somewhere a
				// mark can go.
				if (m[0].length === 0) continue;
				out.push({ start: m.index, end: m.index + m[0].length });
			}
			return out;
		},
	};
}

/** Where one query is found in one string. Shorthand for a single question. */
export function matchRanges(text: string, query: SearchQuery): HitRange[] {
	return compileQuery(query).ranges(text);
}

/**
 * Every node whose visible text matches, in document order.
 *
 * An empty query finds nothing rather than everything: the bar is open for most
 * of a search session, and "all of them" is not a useful thing to highlight.
 *
 * The document rather than its root, because a note-content card is not a node
 * in the tree at all -- the view synthesises one per body range at paint time,
 * and what a search has to read to find it is the *lines* it will be drawn
 * from, which only the document holds. So a body card is searched as the ranges
 * of its owner, and named with the key the view will have given it.
 */
export function searchTree(doc: ParsedDoc, query: SearchQuery): SearchResult {
	const matches: SearchMatch[] = [];
	if (query.text === "") return { matches, invalid: false };

	const matcher = compileQuery(query);
	if (matcher.invalid) return { matches, invalid: true };
	const hits = (text: string): boolean => matcher.ranges(text).length > 0;

	walk(doc.root, (node) => {
		// A virtual root stands for the filename and owns no line; a body card
		// is note content the map only displays.
		if (node.virtual || node.kind === "body") return;
		const text = plainText(node.text);
		if (hits(text)) matches.push({ key: node.key, id: node.id, text });
		if (query.titlesOnly) return;

		// The owner's own ranges, in the order the view draws them, so a match
		// in the second block of a card steps after one in the first.
		for (const [index, [start, end]] of node.bodyRanges.entries()) {
			// Trimmed first: a range carries the blank lines on either side of
			// the block, and a card does not draw them.
			const raw = doc.doc.lines.slice(start, end + 1).join("\n").trim();
			if (raw === "") continue;
			const body = plainText(raw);
			if (!hits(body)) continue;
			matches.push({
				key: `${node.key}${BODY_ID_MARK}${index}`,
				id: `${node.id}${BODY_ID_MARK}${index}`,
				text: body,
			});
		}
	});
	return { matches, invalid: false };
}

/**
 * The collapsed ancestors actually keeping a node off the map, outermost first.
 *
 * Outermost first because that is the one a caller wants on its own: opening a
 * node whose own parent is still folded shows nothing, and a selection folded
 * away has to land on the card that swallowed it.
 */
export function hiddenAncestorKeys(node: MindNode, collapsed: ReadonlySet<string>): string[] {
	const keys: string[] = [];
	for (let p: MindNode | null = node.parent; p; p = p.parent) {
		if (collapsed.has(p.key)) keys.push(p.key);
	}
	return keys.reverse();
}

/**
 * The keys a search recorded that are owed a fold again, given the one match it
 * still has to keep on the map.
 *
 * A branch opened to show a match is only owed that for as long as that match is
 * the one being looked at, so stepping away hands every other recorded key back.
 * `keep`'s own ancestors are the exception: folding one of those would put the
 * card the caller just found straight back out of sight. `keep` itself is not an
 * exception -- a folded node still draws its own card, so nothing is lost.
 *
 * `null` keeps nothing, which is how "there is no match any more" is spelled.
 * Order is the set's own; every caller folds all of them.
 */
export function refoldKeys(revealed: ReadonlySet<string>, keep: MindNode | null): string[] {
	const spared = new Set<string>();
	for (let p: MindNode | null = keep?.parent ?? null; p; p = p.parent) spared.add(p.key);
	return [...revealed].filter((key) => !spared.has(key));
}

/**
 * Whether nothing below the first level is open.
 *
 * The question a fold control asks when it has to say what pressing it will do:
 * collapsing folds *from* the first level, so a map already at its first level
 * is one where collapsing again would change nothing. The root is not one of the
 * levels being asked about -- that fold leaves it open, and counting it would
 * leave a map of a single branch with no way to ask for the whole thing -- but a
 * root folded by hand hides everything below it, and that reads as folded.
 *
 * `hasChildren` is passed in rather than read off the node: whether a section has
 * anything to hide depends on settings this layer does not know.
 */
export function foldedToFirstLevel(
	root: MindNode,
	collapsed: ReadonlySet<string>,
	hasChildren: (node: MindNode) => boolean,
): boolean {
	if (collapsed.has(root.key)) return true;
	for (const child of root.children) {
		if (!hasChildren(child)) continue;
		if (!collapsed.has(child.key)) return false;
	}
	return true;
}
