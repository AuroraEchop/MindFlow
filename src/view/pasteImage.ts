/**
 * Pasting a picture onto a card.
 *
 * In an editor, a pasted screenshot lands in the vault and the note keeps a
 * link to it -- and a link is all an `![[...]]` ever was, which is why the map
 * that draws the picture does not have to know how it got there. What this file
 * adds is the half the map was missing: the clipboard read, and the decision
 * about whether what arrived is the map's business at all.
 *
 * Everything that decides *what* the clipboard carried is pure and lives at the
 * top; the listener is the second half. The split is the one `dropNote.ts`
 * makes, for the same reason: what lands in the user's note is a link this file
 * wrote, and that is the half worth testing.
 *
 * Three answers, and the third is the one that keeps the map out of the way:
 *
 * - one picture as bytes: a screenshot, or Copy Image in a browser;
 * - one picture as an address, which the vault half fetches once and files away
 *   -- the one time this plugin goes to the network, and only because the user
 *   pasted an address rather than a picture;
 * - one picture, or none at all: a paste that is not a picture is left to the
 *   platform, so it behaves exactly as it did before this file existed.
 *
 * More than one picture is the map's own refusal rather than the platform's. A
 * card is one line of the note, and three pictures on it are three pictures in
 * a row for the rest of that note's life -- so the paste is declined and said
 * so, which is a better answer than a card the user has to clean up.
 */

import { decodeTarget, markdownTarget, mediaKindOf } from "../model/media.ts";
import { inTextField } from "./textField.ts";

/** The picture types worth naming, and the extension Obsidian gives each. */
const EXTENSIONS: Record<string, string> = {
	"image/avif": "avif",
	"image/bmp": "bmp",
	"image/gif": "gif",
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/svg+xml": "svg",
	"image/tiff": "tiff",
	"image/vnd.microsoft.icon": "ico",
	"image/webp": "webp",
	"image/x-icon": "ico",
};

/**
 * The extension an attachment of this type is filed under, or null when the
 * type is not a picture at all.
 *
 * The extension is what the renderer decides by, so a picture filed under the
 * wrong one is a picture the map refuses to draw. A type that is a picture but
 * is not named here is filed as a PNG: what a clipboard formats and nobody has
 * listed is a screenshot, which is one.
 */
export function extensionForType(type: string): string | null {
	const clean = type.trim().toLowerCase().split(";")[0]?.trim() ?? "";
	if (!clean.startsWith("image/")) return null;
	return EXTENSIONS[clean] ?? "png";
}

/**
 * The one picture address a paste's text names, or null when it names none.
 *
 * Two spellings, and only two: a bare address, and a markdown picture written
 * around one. The second counts because the note has already said what it is --
 * it is the same reading the renderer gives a card's text.
 *
 * Only `http`/`https`, and only when the address ends in an extension the map
 * draws. Everything else is left alone on purpose: this answer has to be given
 * before the platform's own paste is taken away, and an address that only
 * *might* be a picture is not worth eating a text paste for. A picture served
 * from an address that names no file is fetched by nobody and pasted as the
 * words it is, which is the honest answer rather than a guess.
 */
const A_PICTURE_MARKDOWN = /^!\[[^\]]*\]\(([^)]*)\)$/;
const A_WEB_ADDRESS = /^https?:\/\//i;

export function imageAddressIn(text: string): string | null {
	const trimmed = text.trim();
	if (trimmed === "") return null;
	const markdown = A_PICTURE_MARKDOWN.exec(trimmed);
	const target = markdown === null ? trimmed : markdownTarget(markdown[1] ?? "");
	if (!A_WEB_ADDRESS.test(target)) return null;
	return mediaKindOf(target) === "image" ? target : null;
}

/** What a paste should be taken as. */
export type PastePlan =
	/** One picture, already in hand. */
	| { kind: "picture" }
	/** One picture, still at an address. */
	| { kind: "url"; url: string }
	/** More than one picture, which one card has no room for. */
	| { kind: "many" };

/**
 * What a paste carries, or null when the map should leave it alone.
 *
 * `types` is the MIME type of every file the clipboard carried, in order. Text
 * is only read when no picture came as a file: a browser that offers both has
 * the bytes already, and the bytes are what the note should keep.
 */
export function pastePlan(types: readonly string[], text: string): PastePlan | null {
	const pictures = types.filter((type) => type.trim().toLowerCase().startsWith("image/"));
	if (pictures.length > 1) return { kind: "many" };
	if (pictures.length === 1) return { kind: "picture" };
	const url = imageAddressIn(text);
	return url === null ? null : { kind: "url", url };
}

/** Two digits, zero padded. */
function pad(value: number): string {
	return String(value).padStart(2, "0");
}

/**
 * The name Obsidian itself gives a picture pasted out of the clipboard.
 *
 * The same spelling, deliberately. A user who pastes one screenshot into the
 * editor and the next onto a card should meet one convention in the attachment
 * folder, not two -- and this is the name they have already seen.
 */
export function pastedImageName(ext: string, at: Date): string {
	const stamp =
		`${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}` +
		`${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
	return `Pasted image ${stamp}.${ext}`;
}

/** Characters no file name may carry, on the file systems a vault sits on. */
const UNSAFE = /[\\/:*?"<>|]/;

/**
 * The name a picture taken from an address is filed under.
 *
 * The address's own last segment when that is a picture's file name: the name
 * the picture already had is worth more than one made up for it, and it is what
 * makes an attachment folder searchable later. Anything else falls back to the
 * name a clipboard picture would have got -- a query string, a segment that
 * carries characters a file name cannot hold, or one that is not a file name at
 * all.
 */
export function nameForAddress(url: string, ext: string, at: Date): string {
	const cut = url.search(/[?#]/);
	const path = cut === -1 ? url : url.slice(0, cut);
	const slash = path.lastIndexOf("/");
	const segment = decodeTarget(slash === -1 ? path : path.slice(slash + 1)).trim();
	const usable = segment !== "" && !UNSAFE.test(segment) && mediaKindOf(segment) === "image";
	return usable ? segment : pastedImageName(ext, at);
}

/** One picture the map has been handed, waiting to be filed away. */
export type PastedPicture =
	/** The bytes themselves, which the clipboard was carrying. */
	| { kind: "file"; file: File }
	/** An address to read once, and keep the answer. */
	| { kind: "url"; url: string };

/** What the module needs of the view: the surface it listens on, and its cards. */
export interface ImagePasteHost {
	canvas: { viewport: HTMLElement };
	/**
	 * The field a card is open for editing in, or null.
	 *
	 * A paste lands where the caret is when one is open, which is what makes
	 * this the same gesture it is in the editor; with no field open it lands on
	 * the picked card.
	 */
	editingField(): HTMLElement | null;
	/** One picture to file away, and write onto whichever card is holding. */
	pastePicture(picture: PastedPicture): void;
	/** The clipboard carried more than one picture. */
	pasteMany(): void;
}

/** The pictures on the clipboard that arrived as files, in order. */
function imageFiles(data: DataTransfer): File[] {
	const out: File[] = [];
	for (const item of Array.from(data.items ?? [])) {
		if (item.kind !== "file") continue;
		if (!item.type.trim().toLowerCase().startsWith("image/")) continue;
		const file = item.getAsFile();
		if (file !== null) out.push(file);
	}
	return out;
}

/** What the platform wrote into the paste, when it wrote anything readable. */
function clipboardText(data: DataTransfer): string {
	const types = Array.from(data.types ?? []);
	if (!types.includes("text/plain")) return "";
	try {
		return data.getData("text/plain") ?? "";
	} catch {
		return "";
	}
}

/**
 * Listen for a picture being pasted onto the map, and return the way to stop.
 *
 * The listener is on the viewport, which is where the map's own cards live --
 * and also where the field a card is being edited in lives, so one listener
 * answers for both. The field is what makes the guard below necessary: every
 * *other* text field on screen, the find bar and Obsidian's own boxes among
 * them, keeps the platform's paste, because a picture pasted into a search box
 * is not this map's business.
 */
export function attachImagePaste(host: ImagePasteHost): () => void {
	const viewport = host.canvas.viewport;

	const onPaste = (ev: ClipboardEvent): void => {
		const field = host.editingField();
		const target = ev.target;
		const mine = field !== null && target instanceof Node && field.contains(target);
		if (inTextField(target) && !mine) return;

		const data = ev.clipboardData;
		if (data === null) return;
		const files = imageFiles(data);
		const plan = pastePlan(
			files.map((file) => file.type),
			clipboardText(data),
		);
		if (plan === null) return;

		// Taken off the platform, and only now that this is certainly a paste
		// the map is answering for. An address pasted alongside the bytes would
		// otherwise be written into the card as words, next to the picture it
		// names -- and Obsidian's own paste handler is listening further up the
		// document, where a picture pasted onto a card is not its business.
		ev.preventDefault();
		ev.stopPropagation();
		if (plan.kind === "many") {
			host.pasteMany();
			return;
		}
		if (plan.kind === "url") {
			host.pastePicture({ kind: "url", url: plan.url });
			return;
		}
		const file = files[0];
		if (file === undefined) return;
		host.pastePicture({ kind: "file", file });
	};

	viewport.addEventListener("paste", onPaste);
	return () => viewport.removeEventListener("paste", onPaste);
}
