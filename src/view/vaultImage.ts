/**
 * The vault half of "put this pasted picture on the card".
 *
 * `view/pasteImage.ts` decides what the clipboard carried; this files it away
 * and says what it is called. Both need an `App`, so both live here rather than
 * in the model layer -- and the split is the one `noteLink.ts` makes between
 * what a node's words become and which note they point at.
 *
 * The one thing this file does that the rest of the plugin does not: read an
 * address. Every other picture the map draws is already a file in the vault,
 * and the map has never gone to the network on a note's behalf. This goes there
 * only when the user pastes an address, once, and what comes back is written
 * into the vault -- after which the map is looking at a local file like any
 * other. Nothing here runs on its own, and nothing here reads a note.
 *
 * Where the file lands is Obsidian's own answer rather than the plugin's:
 * `getAvailablePathForAttachment` is the same call the editor's paste goes
 * through, so a screenshot pasted onto a card and one pasted into the note land
 * in the same folder, under the name the folder's own settings ask for -- and a
 * name already taken grows the same ` 1` suffix instead of overwriting a file.
 */

import { requestUrl } from "obsidian";
import type { App, TFile } from "obsidian";

import { extensionOf } from "../model/media.ts";
import { extensionForType, nameForAddress } from "./pasteImage.ts";

/** The bytes behind an address, and the name they are to be filed under. */
export interface GrabbedPicture {
	name: string;
	data: ArrayBuffer;
}

/**
 * Write `data` into the vault as an attachment of the note being mapped.
 *
 * Null is the ordinary answer for a write that failed, and the caller says so
 * once. Nothing is retried and no file is opened for writing: the bytes arrive
 * from a clipboard or from a server, and either is worth exactly one attempt.
 */
export async function savePicture(
	app: App,
	name: string,
	data: ArrayBuffer,
	sourcePath: string,
): Promise<TFile | null> {
	try {
		const path = await app.fileManager.getAvailablePathForAttachment(name, sourcePath);
		return await app.vault.createBinary(path, data);
	} catch (error) {
		console.error("MindFlow: could not save the pasted picture.", error);
		return null;
	}
}

/**
 * Read one address, and answer with the picture it served.
 *
 * Refused unless the server says it is serving a picture. A URL that ends in
 * `.png` and answers with an HTML error page is the case this exists for: filed
 * away anyway, it would be an attachment the map draws as a broken box, in a
 * vault the user now has to tidy. A server that names no type at all is taken
 * at its word -- the address's own extension was checked before the read began,
 * and a picture served from an address that names no file is a paste this file
 * never sees.
 */
export async function pictureFromUrl(url: string, at: Date): Promise<GrabbedPicture | null> {
	try {
		const response = await requestUrl({ url });
		const type = header(response.headers, "content-type").split(";")[0]?.trim() ?? "";
		if (type !== "" && !type.toLowerCase().startsWith("image/")) return null;
		// The extension the file is filed under: the server's own type when it
		// named one, and otherwise the address's.
		const ext = extensionForType(type) ?? (extensionOf(url) || "png");
		return { name: nameForAddress(url, ext, at), data: response.arrayBuffer };
	} catch (error) {
		console.error("MindFlow: could not read the picture at", url, error);
		return null;
	}
}

/** One header, whatever case the server spelled it in. */
function header(headers: Record<string, string>, name: string): string {
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === name) return headers[key] ?? "";
	}
	return "";
}
