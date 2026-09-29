/**
 * What a link card shows of the note it points at.
 *
 * The card is a door, and a door with nothing written on it makes the user open
 * it to find out whether it was the right one. This is the writing: the first
 * few lines of the note, so a glance is enough for the ordinary case and the
 * whole note stays one press away for the rest.
 *
 * The lines come back **as the note wrote them**, and `previewBlocks` is what
 * turns them into what the card draws. That is the whole of the difference from
 * the first version of this, which took the markers off here and drew a run of
 * text: a sample, a table and a callout are only those things while their
 * scaffolding is still in place, so a preview that stripped first could only
 * ever be a run of text -- and a note whose content is a table was read out as
 * `| a | b |`. The stripping still happens, but afterwards, and to paragraphs
 * alone, where the scaffolding really is all it is.
 *
 * The frontmatter rule is `parse.ts`'s, repeated rather than shared because
 * what it returns is a line index into a document this module never holds.
 */

import type { MindNode } from "../model/types.ts";
import { parseMarkdown } from "../model/parse.ts";
import { parseBlocks } from "../model/blocks.ts";
import type { Block } from "../model/blocks.ts";
import { cardLink } from "../model/noteName.ts";
import { t } from "../i18n.ts";

const FRONTMATTER_OPEN = /^---[ \t]*$/;
const FRONTMATTER_CLOSE = /^(?:---|\.\.\.)[ \t]*$/;

/**
 * How a line is written, stripped off so a paragraph reads as what it says.
 *
 * Headings and task boxes: the markers a *paragraph* can carry and that are not
 * part of what it says. Bullets and numbers are deliberately not among them --
 * a line that opens with one is an item, `parseBlocks` reads it as one, and a
 * list drawn as a list is a list that kept its markers. Nor is the `>` of a
 * quote, which is not a paragraph at all: `parseBlocks` reads a quoted line as
 * the callout or the quote it is, and taking the marker off here would be
 * taking the bar off a box the card is about to draw. A line that is nothing
 * but a marker is left empty and dropped.
 */
const BLOCK_MARKER = /^(?:#{1,6}[ \t]+|\[[ xX]\][ \t]*)+/;

/** Long enough to say something, short enough not to become the card. */
const PREVIEW_LINE_CHARS = 120;

/**
 * The most of a note ever prepared, whatever the setting asks for.
 *
 * The cache is keyed by the file's stamp, so raising the line count would
 * otherwise mean reading and splitting the file again. Preparing generously
 * once means the setting is a slice, and moving the slider redraws rather than
 * re-reads.
 */
export const PREVIEW_CACHE_LINES = 40;

export interface LinkPreview {
	/** The lines to draw, exactly as the note wrote them. */
	lines: string[];
	/** How many content lines the card is leaving out. */
	more: number;
}

/** Frontmatter is never part of a map, and it is not part of a preview either. */
function bodyStart(lines: readonly string[]): number {
	if (lines.length === 0 || !FRONTMATTER_OPEN.test(lines[0])) return 0;
	for (let i = 1; i < lines.length; i++) {
		if (FRONTMATTER_CLOSE.test(lines[i])) return i + 1;
	}
	// Unterminated: not frontmatter at all.
	return 0;
}

/** Whether a line has anything on it, which is what the budget is spent on. */
function hasContent(line: string): boolean {
	return line.trim() !== "";
}

/**
 * Where the first `budget` content lines of `lines` end.
 *
 * Content, not lines. A blank line is free at both ends of this module: it says
 * a paragraph has ended and the next has begun, which is a fact the card has to
 * be told, and charging a line of the budget for it would mean the setting
 * bought fewer paragraphs than it says. `previewOfNote` and `clipPreview` ask
 * the same question of the same lines, which is what makes the setting a slice
 * of one read rather than a second reading with its own idea of the answer.
 */
function contentEnd(lines: readonly string[], budget: number): number {
	let end = 0;
	let seen = 0;
	while (end < lines.length && seen < budget) {
		if (hasContent(lines[end])) seen++;
		end++;
	}
	return end;
}

/** How many content lines are left in `lines` from `from` on. */
function contentLeft(lines: readonly string[], from: number): number {
	let count = 0;
	for (let i = from; i < lines.length; i++) if (hasContent(lines[i])) count++;
	return count;
}

/**
 * The first `maxLines` content lines of `text`, as the note wrote them.
 *
 * Fences, table rows and the `>` of a callout are carried along with the rest,
 * because they are what makes those lines what they are: `previewBlocks` reads
 * the slice as markdown, and markdown read from a slice with its scaffolding
 * taken off is prose that happens to contain pipes and backticks.
 *
 * A slice may end in the middle of a block, and that is left alone. The card
 * says how much it is not showing either way, and a sample that stops where the
 * budget stopped is a truer account of a note too long for the card than a
 * paragraph of hashes would be.
 */
export function previewOfNote(text: string, maxLines: number): LinkPreview {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	const body = lines.slice(bodyStart(lines));
	let end = contentEnd(body, Math.max(0, maxLines));
	// The blank line a file ends with is not part of it. A slice that ran out
	// mid-note has no such tail -- `contentEnd` stops on a content line -- so
	// this only ever takes off the note's own last newline, and with it the
	// blanks left by a note that ended with a few.
	while (end > 0 && !hasContent(body[end - 1])) end--;
	return { lines: body.slice(0, end), more: contentLeft(body, end) };
}

/** Whatever the preview setting asks for, out of what the cache prepared. */
export function clipPreview(preview: LinkPreview, maxLines: number): LinkPreview {
	const end = contentEnd(preview.lines, Math.max(0, maxLines));
	if (end === preview.lines.length) return preview;
	return { lines: preview.lines.slice(0, end), more: preview.more + contentLeft(preview.lines, end) };
}

/**
 * The slice, as the card's own block renderer wants it.
 *
 * Two passes, and each answers a question the other cannot. The lines are read
 * **as written**, because a fence, a delimiter row and a `[!type]` are only
 * those things while their scaffolding is in place. Then the paragraphs alone
 * have their scaffolding taken off, because in a paragraph that is all it is: a
 * heading read as characters says `## 安装依赖` where the note says a heading,
 * and the card has its own way of saying a heading.
 *
 * Nothing here reaches the network or a file. What a picture in a preview costs
 * is decided by the media context the card hands the renderer, which is the
 * setting the rest of the map already answers to.
 */
export function previewBlocks(preview: LinkPreview): Block[] {
	if (preview.lines.length === 0) return [];
	return stripParagraphs(parseBlocks(preview.lines.join("\n")));
}

function stripParagraphs(blocks: readonly Block[]): Block[] {
	const out: Block[] = [];
	for (const block of blocks) {
		if (block.kind === "paragraph") {
			const text = block.text
				.split("\n")
				.map(stripLine)
				.filter((line) => line !== "")
				.join("\n");
			// A paragraph that was nothing but markers is nothing to draw.
			if (text !== "") out.push({ kind: "paragraph", text });
		} else if (block.kind === "callout" || block.kind === "quote") {
			out.push({ ...block, blocks: stripParagraphs(block.blocks) });
		} else {
			out.push(block);
		}
	}
	return out;
}

/**
 * One paragraph line as the card reads it: marker off, and cut if it runs on.
 *
 * The cut is paragraphs only. A sample's lines are the sample, and a line cut
 * out of one would be a program that no longer runs with a copy button that
 * copies it that way; a table row is as wide as the columns under it.
 */
function stripLine(line: string): string {
	const stripped = line.replace(BLOCK_MARKER, "").trim();
	if (stripped === "") return "";
	return stripped.length > PREVIEW_LINE_CHARS
		? `${stripped.slice(0, PREVIEW_LINE_CHARS)}…`
		: stripped;
}

/**
 * The name of the note a link points at, for a card with no words of its own.
 *
 * A link written without a label is spelled as its target -- `[[Notes/Guide]]`,
 * path and all -- and showing that would be showing how the note is written
 * rather than what it is called. A heading or block reference belongs to the
 * link rather than to the note, so it comes off with the folder.
 */
export function noteTitleOf(target: string): string {
	const cut = target.lastIndexOf("/");
	const name = cut === -1 ? target : target.slice(cut + 1);
	return name.split("#")[0].split("^")[0] || target;
}

/**
 * Whether a node is one the arrow and the preview answer to.
 *
 * Asked of `cardLink`, which is wider than `soleLink`: a card drawn as a link
 * is a card a reader will press, and a bracket or a full stop written beside
 * the link must not be the reason nothing happens. See `noteName.ts`.
 */
export function isLinkNode(node: MindNode): boolean {
	return cardLink(node.text) !== null;
}

/** A note that could not be found: worth naming in the card that wanted it. */
export function missingNoteLabel(target: string): string {
	return t("view.link.missing", { name: noteTitleOf(target) });
}

/**
 * Where an address points, split for the card that has to name it.
 *
 * The map cannot show a website -- no browser in a card, and no fetching one
 * on the reader's behalf either, which is a promise this plugin already makes
 * about pictures. What it can do is say which site the card is about, which is
 * the part a reader recognises, and hand the address to the browser.
 */
export interface SitePreview {
	/** The site: what a reader recognises, and what the card leads with. */
	host: string;
	/** The rest of the address, on the line under it. */
	path: string;
}

export function siteOf(target: string): SitePreview {
	try {
		const url = new URL(target);
		// `mailto:` and its like parse with no host at all. There is no site to
		// name, so the address itself is what the card leads with.
		if (url.host === "") return { host: target, path: "" };
		return { host: url.host, path: `${url.pathname}${url.search}${url.hash}` };
	} catch {
		// A target the browser refuses to parse is not a reason for a card with
		// nothing on it: what the note wrote is what there is to show.
		return { host: target, path: "" };
	}
}

/** The line a preview shows when it is leaving part of the note out. */
export function moreLinesLabel(more: number): string {
	return t("view.link.moreLines", { count: more });
}

/** Everything a card needs about the note behind it, prepared in one read. */
export interface LinkFile {
	/** The mtime the text was read at, which is what makes the cache honest. */
	stamp: number;
	text: string;
	/** The note's own outline, ready for `projectOutline`. */
	outline: MindNode[];
	/** The first `PREVIEW_CACHE_LINES` lines of it, and what is left over. */
	preview: LinkPreview;
}

/**
 * Read a note's text into the two things a card draws from it.
 *
 * Parsing here rather than at each use is the point: the arrow and the preview
 * are drawn from the same note and must agree about it, and the file is read
 * once and split once however many of the card's parts are showing.
 */
export function prepareLinkFile(text: string, stamp: number): LinkFile {
	return {
		stamp,
		text,
		// `root.children` and not the root: a note's own map draws its title as
		// the root card, and the link node is already that card here.
		outline: parseMarkdown(text, {}).root.children,
		preview: previewOfNote(text, PREVIEW_CACHE_LINES),
	};
}

/**
 * How many notes are held at once.
 *
 * A session reads a note per link card the user opens, and nothing is ever
 * explicitly retired. A read is a few hundred kilobytes of text at the outside
 * and this is far more notes than anyone opens cards for in a sitting; past it
 * the oldest goes, which is the one least likely to be wanted again. Insertion
 * order is the Map's own, so there is no bookkeeping to keep in step with it.
 */
export const MAX_CACHED_READS = 64;

/**
 * What has been read, so a synchronous paint can draw an asynchronous read.
 *
 * `paint` never waits: a card whose note has not arrived yet draws the loading
 * line, the read lands, and the paint after it draws the note. The stamp is the
 * file's mtime, so an edit made anywhere else is noticed without anything having
 * to tell this cache about it -- which is the only reason a cache is safe here
 * at all.
 */
export class LinkReadCache {
	private readonly reads = new Map<string, LinkFile>();

	get(path: string, stamp: number): LinkFile | null {
		const hit = this.reads.get(path);
		return hit && hit.stamp === stamp ? hit : null;
	}

	put(path: string, file: LinkFile): void {
		// Re-inserted rather than left where it was, so the order is least
		// recently written first and the eviction below is the one it claims.
		this.reads.delete(path);
		this.reads.set(path, file);
		while (this.reads.size > MAX_CACHED_READS) {
			const oldest = this.reads.keys().next().value;
			if (oldest === undefined) break;
			this.reads.delete(oldest);
		}
	}

	/** Forget one note: it changed, moved out from under us, or was deleted. */
	forget(path: string): void {
		this.reads.delete(path);
	}

	clear(): void {
		this.reads.clear();
	}
}
