/**
 * The inline markdown a node title is written in, as data.
 *
 * The renderer (`view/nodes.ts`) and the search (`model/search.ts`) have to
 * agree on where a token starts and on which part of it a reader actually sees,
 * so the rules and the tokenizer live here and the renderer keeps nothing but
 * its emit table. Free of every import -- `obsidian` above all -- so
 * `node --test` can run this file as-is.
 *
 * The `$...$` delimiters are deliberately absent. They live in
 * `view/mathSyntax.ts`, which the renderer composes in front of these rules;
 * `plainText` therefore leaves a formula exactly as the note wrote it, dollars
 * and backslashes included, and a formula is searched as its TeX source.
 */

/**
 * What a token means, not how it was spelled: `**a**` and `__a__` are both
 * `strong`, because everything downstream treats them the same.
 */
export type InlineKind =
	| "code"
	| "strong"
	| "strike"
	| "highlight"
	| "em"
	| "wikilink"
	| "image"
	| "link"
	| "embed"
	| "tag";

export interface InlineRule {
	kind: InlineKind;
	/** Global; every scan re-aims `lastIndex` before using it. */
	re: RegExp;
	/** The part of the match a reader sees. */
	visible: (m: RegExpExecArray) => string;
	/** True when what a reader sees is itself markup and must be re-scanned. */
	nested: boolean;
}

/**
 * Deliberately small and ordered: earliest match wins, and the order below is
 * the tie-break contract for an exact draw. `**` has to precede `*`, and the
 * embed rule only survives at the end because `![[x]]` starts one character
 * before the wikilink inside it.
 *
 * `image` and `embed` are both built that way: each starts one character before
 * a rule it contains -- the `link` and the `wikilink` -- and wins on position
 * rather than on order, which is why the two of them may sit on either side of
 * it. Without them the leading `!` would stay on the card as text, in front of
 * a link, and a note's picture would read as `!alt`.
 */
export const INLINE_RULES: InlineRule[] = [
	{ kind: "code", re: /`([^`]+)`/g, visible: (m) => m[1], nested: false },
	{ kind: "strong", re: /\*\*([^*]+)\*\*/g, visible: (m) => m[1], nested: true },
	{ kind: "strong", re: /__([^_]+)__/g, visible: (m) => m[1], nested: true },
	{ kind: "strike", re: /~~([^~]+)~~/g, visible: (m) => m[1], nested: true },
	{ kind: "highlight", re: /==([^=]+)==/g, visible: (m) => m[1], nested: true },
	{ kind: "em", re: /\*([^*]+)\*/g, visible: (m) => m[1], nested: true },
	{
		kind: "wikilink",
		re: /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
		// The alias, or the target when there is none. A target that has been
		// given a label is not something the reader can see.
		visible: (m) => m[2] ?? m[1],
		nested: false,
	},
	{
		kind: "image",
		re: /!\[([^\]]*)\]\(([^)]+)\)/g,
		// The alt text, or the target when the note wrote none. Nothing draws
		// the picture itself -- see the emitter -- so the words beside it are
		// all a reader has.
		visible: (m) => m[1] || m[2],
		nested: false,
	},
	{ kind: "link", re: /\[([^\]]+)\]\(([^)]+)\)/g, visible: (m) => m[1], nested: false },
	{ kind: "embed", re: /!\[\[([^\]]+)\]\]/g, visible: (m) => m[1], nested: false },
	{
		kind: "tag",
		// A tag starts at a `#` that opens the line or follows a space or an
		// opening bracket, and the rule *consumes* that character to say so --
		// which is why the prefix is group 1 and why the emitter puts it back.
		// A lookbehind is the obvious way to write this and the one way it may
		// not be written: Obsidian's review refuses lookbehind outright, because
		// a WebView older than iOS 16.4 does not have it. Consuming the
		// character is also what keeps `C#`, a URL's `#fragment` and a `#`
		// glued to the word before it from being tags.
		//
		// The lookahead refuses a digit, so `#42` stays a number, which is the
		// rule Obsidian itself uses.
		re: /(^|[\s(])#([^\s#\d][^\s#]*)/g,
		// The `#` is the one marker that is part of what a reader sees, which is
		// why this rule's visible text is the match itself and not a group of
		// it: search and the card agree without either of them special-casing.
		// The prefix counts as visible too, or `a #tag` would be found as
		// `a#tag`.
		visible: (m) => `${m[1]}#${m[2]}`,
		nested: false,
	},
];

export interface InlineToken {
	rule: InlineRule;
	start: number;
	/** Index just past the token, where the next scan resumes. */
	end: number;
	match: RegExpExecArray;
}

/**
 * The first token at or after `from`: earliest match wins, an exact tie going to
 * whichever rule is listed first.
 *
 * The patterns are shared and carry `lastIndex`, but every scan re-aims them
 * before it reads, so a nested call can never disturb the one it returns into.
 */
export function nextInlineToken(
	text: string,
	from: number,
	rules: readonly InlineRule[] = INLINE_RULES,
): InlineToken | null {
	let best: InlineToken | null = null;
	for (const rule of rules) {
		rule.re.lastIndex = from;
		const m = rule.re.exec(text);
		if (!m) continue;
		if (best === null || m.index < best.start) {
			best = { rule, start: m.index, end: m.index + m[0].length, match: m };
		}
	}
	return best;
}

/**
 * A title as a reader sees it on the card: markers stripped, link labels kept,
 * link targets dropped.
 *
 * Mirrors `renderInline`'s recursion, so `**bold** text` is found by "bold
 * text" and `[[note|Label]]` by "Label" but never by "note".
 */
export function plainText(text: string): string {
	let out = "";
	let i = 0;
	while (i < text.length) {
		const token = nextInlineToken(text, i);
		if (!token) return out + text.slice(i);
		if (token.start > i) out += text.slice(i, token.start);
		const visible = token.rule.visible(token.match);
		out += token.rule.nested ? plainText(visible) : visible;
		i = token.end;
	}
	return out;
}
