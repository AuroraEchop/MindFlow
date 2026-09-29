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

/**
 * A markdown-spelled link: `[label](target)`, and nothing around it.
 *
 * The other half of the same idea as `SOLE_LINK`, and here for the same reason
 * `soleLink` keeps its own pattern: a card may write a link either way, and a
 * reader cannot see which one the note used. The optional `"title"` is part of
 * the spelling rather than of the target, so it comes off with the brackets.
 */
const SOLE_MARKDOWN_LINK = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/;

/** A link written anywhere in a longer string, for the loose test below. */
const ANY_MARKDOWN_LINK = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const ANY_WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Anything that is not a letter or a digit, in any script.
 *
 * What a card may hold besides its one link and still be a card about that
 * link: whitespace, a bracket, a full stop, an em dash. This is the line
 * between "`() [[Note]]`, which is a link with punctuation beside it" and "a
 * sentence that mentions a note", and the second is not something this may
 * guess a target from.
 */
const NOT_WORDS = /^[^\p{L}\p{N}]*$/u;

/** A target with a scheme: somewhere the vault has no file for. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** A bare address, which is a link the note wrote without any markup at all. */
const BARE_URL = /^(?:https?|mailto):\S+$/i;

/** What a card is about, when it is about one link. */
export interface CardLink extends LinkParts {
	/**
	 * True when the card is that link and nothing else.
	 *
	 * The strict reading, and the one every mutation answers to as well --
	 * renaming and unlinking rewrite the card, and neither may do that to a
	 * card that says anything else.
	 */
	sole: boolean;
	/** True for a target outside the vault: an address rather than a note. */
	external: boolean;
}

function partsOf(target: string, label: string | null): CardLink {
	return { target, label, sole: false, external: HAS_SCHEME.test(target) };
}

/**
 * The one link a card is about, or null when it is about none or several.
 *
 * Wider than `soleLink` on purpose, and the difference is the whole of what a
 * reader sees: a card drawn as a link is a card a reader will press, and a
 * press that does nothing because a bracket or a full stop was written beside
 * the link is the map looking broken. So punctuation around the link is
 * tolerated; words are not, because a sentence that mentions a note has no
 * single target and opening an arbitrary one of its links would be guessing.
 *
 * Both spellings are read. A note may write `[[Note]]` or `[label](Note)`, and
 * nothing on the card tells a reader which it was -- so nothing here may either.
 *
 * `sole` is the narrow answer and is kept beside the wide one: the view opens a
 * card on the wide answer, and renames it on the narrow one.
 */
export function cardLink(text: string): CardLink | null {
	const trimmed = text.trim();

	const sole = soleLink(trimmed);
	if (sole) return { ...sole, sole: true, external: HAS_SCHEME.test(sole.target) };

	const markdown = SOLE_MARKDOWN_LINK.exec(trimmed);
	if (markdown) {
		const target = markdown[2];
		return { target, label: markdown[1] || null, sole: true, external: HAS_SCHEME.test(target) };
	}

	// A card that is nothing but an address is a link too, and this is the one
	// the note wrote without any markup at all. Nothing else is on the card, so
	// it is as `sole` as a wikilink is -- though no mutation answers to one,
	// since there is no markup to rewrite.
	if (BARE_URL.test(trimmed)) {
		return { target: trimmed, label: null, sole: true, external: true };
	}

	// One link with something around it, and that something must not be words.
	const found: Array<{ parts: CardLink; start: number; end: number }> = [];
	const collect = (
		re: RegExp,
		read: (m: RegExpExecArray) => CardLink,
	): void => {
		re.lastIndex = 0;
		for (let m = re.exec(trimmed); m !== null; m = re.exec(trimmed)) {
			found.push({ parts: read(m), start: m.index, end: m.index + m[0].length });
		}
	};
	collect(ANY_WIKILINK, (m) => partsOf(m[1].trim(), m[2]?.trim() ?? null));
	collect(ANY_MARKDOWN_LINK, (m) => partsOf(m[2], m[1] || null));

	if (found.length !== 1) return null;
	const only = found[0];
	const outside = trimmed.slice(0, only.start) + trimmed.slice(only.end);
	if (!NOT_WORDS.test(outside)) return null;
	return only.parts;
}

/**
 * Every link target a string writes, however it spells them.
 *
 * The loose half of `cardLink`, and the one question that needs it: a card of
 * prose is *about* a link by writing it, and what the map opened on such a card
 * stays that card's for as long as the link is still written there.
 */
function linkTargets(text: string): string[] {
	const out: string[] = [];
	ANY_WIKILINK.lastIndex = 0;
	for (let m = ANY_WIKILINK.exec(text); m !== null; m = ANY_WIKILINK.exec(text)) {
		out.push(m[1].trim());
	}
	ANY_MARKDOWN_LINK.lastIndex = 0;
	for (let m = ANY_MARKDOWN_LINK.exec(text); m !== null; m = ANY_MARKDOWN_LINK.exec(text)) {
		out.push(m[2]);
	}
	return out;
}

/**
 * Whether a card reading `text` is still a card about the link `target`.
 *
 * The identity half of the map's link state, and a question about the card's
 * own text rather than about the key it is stored under, because a key is a
 * *place* and a place does not remember what stood in it. A title card's key is
 * its own text, so the two agree; a note-content card's is
 * `ownerKey + mark + index`, and the block the note has at that index is
 * whatever the note last put there. State read back against the bare key
 * therefore outlives the card it was made for: move a block out of a link
 * card's place and the block that takes the place over is handed somebody
 * else's outline -- hanging under a card with no arrow to shut it, because that
 * card is not a link and never drew one.
 *
 * `sole` picks which sentence is meant. A card that must still *be* the link --
 * a card showing another note's outline only a card naming a single note can
 * carry -- is read with the narrow answer, and a card that only has to still
 * write the link somewhere is read with the wide one, because that is how it
 * was opened: a press on a link written in prose opens that note on the card it
 * was written on.
 */
export function cardIsAbout(text: string, target: string, sole: boolean): boolean {
	const own = cardLink(text);
	if (own !== null) return own.target === target;
	return !sole && linkTargets(text).includes(target);
}

/** Whether a link target names somewhere outside the vault. */
export function isExternalTarget(target: string): boolean {
	return HAS_SCHEME.test(target);
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
