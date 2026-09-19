/**
 * The vault half of "make this node a link".
 *
 * `model/noteName.ts` decides what a node's words become; this decides which
 * note they point at, and what to do when there is no such note yet. Both need
 * an `App`, so both live here rather than in the model layer.
 *
 * Nothing in this file writes to the note being mapped. The two ways a node
 * becomes a link -- pointing it at a note that exists, and growing a new note
 * beside the current one -- both end by handing the caller a link target, and
 * the caller is what puts it on the card and into the file.
 */

import { FuzzySuggestModal } from "obsidian";
import type { App, TFile } from "obsidian";

import { t } from "../i18n.ts";
import { nextFreePath } from "../export/paths.ts";

/**
 * The shortest text that still finds `file` from `sourcePath`.
 *
 * Obsidian's own answer rather than the file's basename: a vault with two
 * `Plan.md` in it needs the folder spelled out for one of them, and only the
 * metadata cache knows which. Getting this wrong writes a link that opens the
 * wrong note, which is worse than one that is merely long.
 */
export function linkTextFor(app: App, file: TFile, sourcePath: string): string {
	return app.metadataCache.fileToLinktext(file, sourcePath, true);
}

/** Pick a note out of the vault, the way Obsidian's own switcher does. */
export class NotePickerModal extends FuzzySuggestModal<TFile> {
	private readonly chosen: (file: TFile) => void;

	constructor(app: App, chosen: (file: TFile) => void) {
		super(app);
		this.chosen = chosen;
		this.setPlaceholder(t("view.link.pick"));
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.chosen(file);
	}
}

/** The folder a note lives in, or "" for the vault root. */
export function folderOf(path: string): string {
	const cut = path.lastIndexOf("/");
	return cut === -1 ? "" : path.slice(0, cut);
}

/**
 * Create `<name>.md` beside the note being mapped.
 *
 * Beside rather than at the root: a map is a view of one note, and a note grown
 * from it is a neighbour of that note. The name is made safe by `nextFreePath`
 * against the vault's own file list rather than by trying the write and reading
 * the error -- a taken name becomes `name 1.md`, and no existing file is ever
 * opened for writing.
 */
export async function createNoteBeside(
	app: App,
	sourcePath: string,
	name: string,
): Promise<TFile | null> {
	const taken = new Set(app.vault.getFiles().map((file) => file.path.toLowerCase()));
	const path = nextFreePath(
		(candidate) => taken.has(candidate.toLowerCase()),
		folderOf(sourcePath),
		name,
		"md",
	);
	try {
		// Empty rather than a heading: the node's own words become the link's
		// label, so a heading would say the same thing twice.
		return await app.vault.create(path, "");
	} catch (error) {
		console.error("MindFlow: could not create the note.", error);
		return null;
	}
}
