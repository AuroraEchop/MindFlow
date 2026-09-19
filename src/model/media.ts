/**
 * Which embeds are pictures and videos, and what they point at, as data.
 *
 * The renderer (`view/media.ts`) has to answer two questions before it draws
 * anything: is this target something the map can draw, and what is the vault
 * path inside the link. Both are string work, so both live here -- free of
 * every import, `obsidian` above all, so `node --test` can run this file as-is.
 *
 * Deliberately conservative about what counts as drawable. The map is not a
 * reading view: a card is measured the instant it is built, so anything that
 * arrives late is a card the layout was wrong about. A picture is worth that
 * wait -- a PDF, an audio file or an embedded note is not, and stays the chip
 * it has always been.
 */

export type MediaKind = "image" | "video";

/**
 * The extensions the map draws, lowercased and without the dot.
 *
 * `svg` is here even though it is markup: it reaches the card through an
 * `<img>`, which is the one context a script inside it cannot run in.
 */
const IMAGE_EXTENSIONS = new Set([
	"avif",
	"bmp",
	"gif",
	"ico",
	"jfif",
	"jpeg",
	"jpg",
	"png",
	"svg",
	"webp",
]);

/** What Obsidian's own embed handler plays, minus the formats it does not. */
const VIDEO_EXTENSIONS = new Set(["m4v", "mkv", "mov", "mp4", "ogv", "webm"]);

/**
 * A path's extension, lowercased and without the dot, or "" when it has none.
 *
 * A query string or a fragment is not part of the name -- `a.png?v=2` is a PNG
 * -- and a leading dot is not an extension either: `.gitignore` has no suffix.
 */
export function extensionOf(path: string): string {
	const cut = path.search(/[?#]/);
	const clean = cut === -1 ? path : path.slice(0, cut);
	const dot = clean.lastIndexOf(".");
	if (dot <= 0 || dot === clean.length - 1) return "";
	return clean.slice(dot + 1).toLowerCase();
}

/** The kind of media a target names, or null for everything else. */
export function mediaKindOf(path: string): MediaKind | null {
	const extension = extensionOf(path);
	if (IMAGE_EXTENSIONS.has(extension)) return "image";
	if (VIDEO_EXTENSIONS.has(extension)) return "video";
	return null;
}

export interface EmbedTarget {
	/** The vault path, with any `#heading` or `^block` reference taken off. */
	path: string;
	/** The alias, or null when the note wrote none. A size hint is not one. */
	label: string | null;
	/** The `|300` or `|300x200` hint, as a width in pixels, or null. */
	width: number | null;
}

/** `300` or `300x200` -- Obsidian's own way of sizing an embed. */
const SIZE_HINT = /^(\d+)(?:x\d+)?$/;

/**
 * What an `![[...]]` names.
 *
 * Three things are spelled inside those brackets and only one of them is the
 * file: `|` introduces an alias, `#` a heading and `^` a block. A picture never
 * has the last two, but an embed of a note does, and the same code reads both.
 *
 * The alias is dropped when it is a size instead: `![[a.png|300]]` is not a
 * picture called "300", it is one drawn 300 pixels wide, and the map honours it
 * as an upper bound on the width it would have chosen anyway.
 */
export function parseEmbedTarget(raw: string): EmbedTarget {
	const bar = raw.indexOf("|");
	const head = bar === -1 ? raw : raw.slice(0, bar);
	const tail = bar === -1 ? "" : raw.slice(bar + 1).trim();

	const marker = head.search(/[#^]/);
	const path = (marker === -1 ? head : head.slice(0, marker)).trim();

	const size = SIZE_HINT.exec(tail);
	if (size) return { path, label: null, width: Number(size[1]) };
	return { path, label: tail === "" ? null : tail, width: null };
}

/**
 * What an `![alt](target)` points at.
 *
 * The spelling markdown allows around a target is not part of it: `<My File.png>`
 * is wrapped in angle brackets because of the space, and a trailing `"title"`
 * is the hover text. Both are stripped, the same way the link renderer strips
 * them, so `![a](My%20File.png)` and `![[My File.png]]` reach the vault as one
 * path.
 */
export function markdownTarget(raw: string): string {
	return raw.trim().replace(/^<(.*)>$/, "$1").replace(/\s+"[^"]*"$/, "").trim();
}

/**
 * Percent-decoding, for a markdown target that had to escape its spaces.
 *
 * A stray `%` is not an escape and is left as written, which is what the link
 * opener has always done.
 */
export function decodeTarget(target: string): string {
	try {
		return decodeURIComponent(target);
	} catch {
		return target;
	}
}
