import { TFile } from "obsidian";
import type { App } from "obsidian";

import { extensionOf, mediaKindOf } from "../model/media.ts";

/**
 * What the export owes a picture that the map was drawing.
 *
 * An exported document carries no stylesheet and no external resource: the SVG
 * is a self-contained fragment, and the PNG is that fragment drawn by an
 * `<img>`, which fetches nothing at all -- not even a file sitting next to it.
 * So a picture whose `src` is the map's own `app://` address is a picture that
 * is simply missing from the file, and there is no way around that but to put
 * the bytes in.
 *
 * That is what this does, and it does it on the live map rather than on the
 * clone, because `snapshot.ts` serializes one tree and nothing else. The
 * sources are put back in the `finally` of the export, so the map on screen is
 * the map that was there before.
 *
 * Videos are not inlined. A minute of 1080p is a hundred megabytes of base64
 * inside an HTML file, which is not an export -- so a video becomes the chip it
 * was before this feature existed, and the file keeps a name and a click.
 */

/** The MIME types a picture can be written into a data URI under. */
const MIME: Record<string, string> = {
	avif: "image/avif",
	bmp: "image/bmp",
	gif: "image/gif",
	ico: "image/x-icon",
	jfif: "image/jpeg",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	png: "image/png",
	svg: "image/svg+xml",
	webp: "image/webp",
};

/**
 * Inline every picture in `content`, and hand back the undo.
 *
 * The caller owns the undo and must run it in a `finally`: it puts the resource
 * URLs back, which is what keeps the map working after the export.
 */
export async function inlineExportMedia(app: App, content: HTMLElement): Promise<() => void> {
	const restore: Array<() => void> = [];

	for (const wrap of Array.from(content.querySelectorAll<HTMLElement>(".mm-media"))) {
		const path = wrap.dataset.mediaPath;
		if (path === undefined) continue;
		const kind = mediaKindOf(path);

		if (kind === "video") {
			restore.push(demote(wrap));
			continue;
		}
		if (kind !== "image") continue;

		const img = wrap.querySelector("img");
		if (!img) continue;
		const source = img.getAttribute("src");
		if (source === null || source.startsWith("data:")) continue;

		const uri = await dataUri(app, path);
		// A file that has gone missing since the map was drawn is left as it is:
		// a broken address in the export is the same nothing a data URI of
		// nothing would have been, and it keeps the map's own state untouched.
		if (uri === null) continue;

		img.setAttribute("src", uri);
		restore.push(() => img.setAttribute("src", source));
	}

	return () => {
		for (const undo of restore.reverse()) undo();
	};
}

/** Swap a video card for the chip an embed used to be, and hand back the undo. */
function demote(wrap: HTMLElement): () => void {
	// The link, or -- for a video that was playing, which is a player and not a
	// link -- the file it came from. Either way the chip says what it is.
	const href = wrap.dataset.href ?? wrap.dataset.mediaPath ?? "";
	const chip = createSpan({ cls: "mm-embed", text: href });
	if (href !== "") chip.dataset.href = href;
	wrap.replaceWith(chip);
	return () => chip.replaceWith(wrap);
}

/** The file's bytes as a data URI, or null when it cannot be read. */
async function dataUri(app: App, path: string): Promise<string | null> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return null;

	const mime = MIME[extensionOf(path)];
	if (mime === undefined) return null;

	try {
		const bytes = new Uint8Array(await app.vault.readBinary(file));
		return `data:${mime};base64,${toBase64(bytes)}`;
	} catch (error) {
		console.error("MindFlow: could not read a picture for the export.", path, error);
		return null;
	}
}

/**
 * Base64, in chunks.
 *
 * `String.fromCharCode(...bytes)` spreads one argument per byte, and a
 * photograph is a few million of them -- which is a stack overflow rather than
 * a string. The chunk is what keeps a large picture from taking the export with
 * it.
 */
const BASE64_CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
	}
	return btoa(binary);
}
