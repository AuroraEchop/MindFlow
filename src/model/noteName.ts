/**
 * What a node's words become when they have to be a note's name, and how a
 * note is spelled back as a link.
 *
 * Both are string work and neither needs a vault, so both live here -- free of
 * every import, `obsidian` above all, so `node --test` can run this file as-is.
 * The vault-side half (which note the user picked, and whether a file of that
 * name is already there) is `view/noteLink.ts`.
 *
 * The name is deliberately not "whatever the node says". A node's text is
 * prose and may hold anything at all -- a slash, a question mark, a colon that
 * a heading marker left behind -- and every one of those is either illegal in a
 * file name or means something else to Obsidian.
 */

/** Everything a file name may not carry, across the platforms this runs on. */
const ILLEGAL = /[\\/:*?"<>|#^[\]]/g;

/**
 * How long a generated name may get.
 *
 * Not a platform limit -- the shortest one that bites is 255 bytes -- but a
 * name is also a link, and a link is read on a card. Long enough for a real
 * sentence fragment, short enough to still be a label.
 */
export const MAX_NOTE_NAME = 80;

/** One `[[...]]`, and nothing else in the string. */
const SOLE_LINK = /^\[\[([^\][]+)\]\]$/;

/** A link's two halves: what it points at, and what it is called. */
export interface LinkParts {
	/** The note it names, with any `#heading` or `^block` left on. */
	target: string;
	/** The `|label`, or null when the note wrote none. */
	label: string | null;
}

/**
 * The link a string is, when the whole of it is one link.
 *
 * Used in both directions: to decide whether a node is already a link (and so
 * has nothing to link to), and to work out what unlinking one should leave
 * behind. A link with anything else around it is not one of these -- a sentence
 * that mentions a note is a sentence, and rewriting it would lose the sentence.
 */
export function soleLink(text: string): LinkParts | null {
	const match = SOLE_LINK.exec(text.trim());
	if (!match) return null;
	const inner = match[1];
	const bar = inner.indexOf("|");
	if (bar === -1) return { target: inner.trim(), label: null };
	return { target: inner.slice(0, bar).trim(), label: inner.slice(bar + 1).trim() };
}

/** A link to `target`, labelled only when the label says something new. */
export function linkMarkup(target: string, label?: string | null): string {
	const trimmed = label?.trim() ?? "";
	if (trimmed === "" || trimmed === target) return `[[${target}]]`;
	return `[[${target}|${trimmed}]]`;
}

/**
 * What unlinking a node should leave in its place.
 *
 * The label when the note wrote one, and otherwise the target with any `#` or
 * `^` reference taken off -- so `[[Notes/a#Part]]` becomes `a`, which is the
 * name a reader saw on the card.
 */
export function unlinkedText(parts: LinkParts): string {
	if (parts.label !== null && parts.label !== "") return parts.label;
	const marker = parts.target.search(/[#^]/);
	return marker === -1 ? parts.target : parts.target.slice(0, marker);
}

/**
 * A file name made from a node's text, or "" when there is nothing to use.
 *
 * Whitespace collapses because a name with a double space in it is a name
 * nobody can retype, and the ends are trimmed because a leading or trailing
 * space is invisible in a link and turns into `%20` everywhere else.
 */
export function noteNameFrom(text: string): string {
	const cleaned = text
		// A node that is already a link names its own target; the markup around
		// it is not part of what it is called.
		.replace(/\[\[([^\][]+)\]\]/g, (_all, inner: string) => {
			const bar = inner.indexOf("|");
			return bar === -1 ? inner : inner.slice(bar + 1);
		})
		// Emphasis, but only where it is paired. Stripping every `_` would turn
		// `snake_case` into `snakecase`, which is a different name.
		.replace(/\*\*(.+?)\*\*/g, "$1")
		.replace(/__(.+?)__/g, "$1")
		.replace(/\*(.+?)\*/g, "$1")
		.replace(/`(.+?)`/g, "$1")
		.replace(/~~(.+?)~~/g, "$1")
		.replace(ILLEGAL, " ")
		.replace(/\s+/g, " ")
		.trim()
		// A trailing dot is legal on Linux and refused on Windows, and a name
		// of dots is not a name on either.
		.replace(/^[.\s]+|[.\s]+$/g, "")
		.slice(0, MAX_NOTE_NAME)
		.trim();
	return cleaned;
}
