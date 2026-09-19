/**
 * How one line of note text becomes DOM.
 *
 * The rules themselves live in `model/inlineText.ts`, where the search reads
 * them too; this is only the other half of that pair. It sits in a file of its
 * own rather than inside `nodes.ts` because two things draw with it -- a card's
 * title, and a paragraph inside a note-content block -- and a block that
 * imported it from the node builder would be importing its own caller.
 *
 * Deliberately DOM-based throughout: every value goes in as text, never as
 * HTML, so a note can never inject markup into the map. The one exception is a
 * picture, which is an element rather than a string by nature; it is built from
 * a resource URL the vault itself resolved, and it is still not markup.
 */

import { t } from "../i18n.ts";
import { markdownTarget, parseEmbedTarget } from "../model/media.ts";
import { nextInlineToken } from "../model/inlineText.ts";
import type { InlineKind } from "../model/inlineText.ts";
import { renderMathInto } from "./math.ts";
import { MATH_DISPLAY, MATH_INLINE } from "./mathSyntax.ts";
import { renderMedia } from "./media.ts";
import type { MediaContext } from "./media.ts";

/** Carried through the recursion so nested markup can report what it emitted. */
export interface InlineContext {
	sawMath: boolean;
	sawMedia: boolean;
	/** Null when the map is not drawing media: every embed stays a chip. */
	media: MediaContext | null;
}

/** What one run of text put on the card, so the view knows what to wait for. */
export interface InlineRender {
	math: boolean;
	media: boolean;
}

type Emit = (m: RegExpExecArray, el: HTMLElement, ctx: InlineContext) => void;

/**
 * A link, with its target carried as data rather than as an `href`.
 *
 * Never an `<a href>`: a note that writes `[click](javascript:…)` would then be
 * one click away from running script in the renderer. The target stays inert
 * text until the view is asked to open it, and the view refuses the schemes it
 * does not know.
 */
function linkSpan(el: HTMLElement, cls: string, label: string, target: string): void {
	const span = el.createSpan({ cls, text: label });
	// `<path>` wrapping and a trailing `"title"` are markdown-link syntax, not
	// part of what the link points at.
	const href = markdownTarget(target);
	if (href !== "") span.dataset.href = href;
}

/**
 * An `![[...]]` or an `![...](...)`, drawn as the picture it names.
 *
 * Returns false when the target is not something the map draws -- a PDF, a
 * note, a file that is no longer there -- and the caller falls back to the chip
 * below, which is what every embed used to be.
 */
function mediaInto(
	el: HTMLElement,
	target: string,
	label: string,
	ctx: InlineContext,
	maxWidth?: number,
): boolean {
	if (ctx.media === null) return false;
	if (!renderMedia(el, target, label, ctx.media, maxWidth)) return false;
	ctx.sawMedia = true;
	return true;
}

/**
 * How each inline rule becomes DOM.
 *
 * A `Record` over the kinds is what keeps the two halves together: a rule added
 * in `model/inlineText.ts` without an emitter here is a compile error, not a
 * token that silently renders as nothing.
 */
const EMIT: Record<InlineKind, Emit> = {
	code: (m, el) => el.createEl("code", { cls: "mm-code", text: m[1] }),
	strong: (m, el, ctx) => renderRange(el.createEl("strong"), m[1], ctx),
	strike: (m, el, ctx) => renderRange(el.createEl("del"), m[1], ctx),
	highlight: (m, el, ctx) => renderRange(el.createEl("mark"), m[1], ctx),
	em: (m, el, ctx) => renderRange(el.createEl("em"), m[1], ctx),
	wikilink: (m, el) => linkSpan(el, "mm-link", m[2] ?? m[1], m[1]),
	link: (m, el) => linkSpan(el, "mm-link", m[1], m[2]),
	// The alt text, or the target when the note wrote none -- and the picture
	// itself when the map is drawing them. A card is measured the moment it is
	// built, so `media.ts` is what makes a picture arriving later cost one
	// re-measurement rather than a map laid out around a box that no longer
	// exists.
	image: (m, el, ctx) => {
		const target = markdownTarget(m[2]);
		if (mediaInto(el, target, m[1] || target, ctx)) return;
		linkSpan(el, "mm-embed", m[1] || target, m[2]);
	},
	embed: (m, el, ctx) => {
		// `![[a.png|300]]` is a size, not a label, and it caps what the map
		// would otherwise have drawn the picture at.
		const parsed = parseEmbedTarget(m[1]);
		const label = parsed.label ?? parsed.path;
		if (mediaInto(el, parsed.path, label, ctx, parsed.width ?? undefined)) return;
		linkSpan(el, "mm-embed", m[1], m[1]);
	},
	// A badge rather than a link: a tag is a label, not a destination. The map
	// does not filter or search by it, and drawing it as something clickable
	// would promise a click that goes nowhere.
	//
	// The rule had to consume the space or the bracket in front of the `#` to
	// say the `#` was allowed to be there -- a lookbehind would have done it
	// without eating the character, and Obsidian's review does not allow one.
	// So the prefix goes back on the card first, as the character it was.
	tag: (m, el) => {
		if (m[1] !== "") el.appendText(m[1]);
		el.createSpan({ cls: "mm-tag", text: `#${m[2]}` });
	},
};

const MATH_PATTERNS: Array<[RegExp, Emit]> = [
	[
		MATH_DISPLAY,
		(m, el, ctx) => {
			ctx.sawMath = true;
			renderMathInto(el, m[1], true);
		},
	],
	[
		MATH_INLINE,
		(m, el, ctx) => {
			ctx.sawMath = true;
			renderMathInto(el, m[1], false);
		},
	],
];

interface Token {
	start: number;
	end: number;
	emit: (el: HTMLElement) => void;
}

/**
 * Math is scanned first and an inline token only adopted on a strict `<`, so a
 * formula wins an exact-index tie. Everything past that is decided by
 * earliest-match-wins, which is what keeps `$a_b$` away from the `__` rule and
 * `$x*y*z$` away from the `*` rule.
 */
function nextToken(text: string, from: number, ctx: InlineContext): Token | null {
	let best: Token | null = null;
	for (const [re, emit] of MATH_PATTERNS) {
		re.lastIndex = from;
		const m = re.exec(text);
		if (!m) continue;
		if (best === null || m.index < best.start) {
			best = {
				start: m.index,
				end: m.index + m[0].length,
				emit: (el) => emit(m, el, ctx),
			};
		}
	}
	const inline = nextInlineToken(text, from);
	if (inline && (best === null || inline.start < best.start)) {
		const emit = EMIT[inline.rule.kind];
		best = {
			start: inline.start,
			end: inline.end,
			emit: (el) => emit(inline.match, el, ctx),
		};
	}
	return best;
}

function renderRange(el: HTMLElement, text: string, ctx: InlineContext): void {
	let i = 0;
	while (i < text.length) {
		const token = nextToken(text, i, ctx);
		if (!token) {
			el.appendText(text.slice(i));
			return;
		}
		if (token.start > i) el.appendText(text.slice(i, token.start));
		token.emit(el);
		i = token.end;
	}
}

/**
 * Draw one run of note text, and report what it contained.
 *
 * `media` is the map's licence to draw pictures and videos, or null when it is
 * not drawing them -- in which case an embed is the chip it has always been.
 * The math half of the answer is what tells the view to re-measure once MathJax
 * has flushed its stylesheet; the media half says the same about a picture.
 */
export function renderInline(
	el: HTMLElement,
	text: string,
	media: MediaContext | null = null,
): InlineRender {
	el.empty();
	if (text.trim() === "") {
		el.createSpan({ cls: "mm-placeholder", text: t("view.node.placeholder") });
		return { math: false, media: false };
	}
	const ctx: InlineContext = { sawMath: false, sawMedia: false, media };
	renderRange(el, text, ctx);
	return { math: ctx.sawMath, media: ctx.sawMedia };
}

/**
 * The same, without the placeholder.
 *
 * A blank line is a thing to read on a title, where the card would otherwise be
 * an empty box; inside a table cell it is simply an empty cell, and a card that
 * said "Empty" in one would be inventing content the note does not have.
 */
export function renderInlineOrNothing(
	el: HTMLElement,
	text: string,
	media: MediaContext | null = null,
): InlineRender {
	if (text.trim() === "") return { math: false, media: false };
	return renderInline(el, text, media);
}
