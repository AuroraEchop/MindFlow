/**
 * Dropping a note onto the map.
 *
 * A note dragged out of the file explorer and let go over the map becomes a
 * card on it: `[[Note]]`, written into the note the map is showing, as a child
 * of whatever card it was dropped on -- or of the root when it was dropped on
 * empty canvas. The card then opens its own outline, because a reader who
 * dragged a note here asked to read it, not to be handed a link to press.
 *
 * Everything that decides *what* was dropped is pure and lives at the top of
 * this file; the listeners are the second half. The split is deliberate: a
 * payload that turns into the wrong link is a wrong note written into the
 * user's file, and that is the half worth testing.
 *
 * The map already has a drag of its own -- a card carried to another card --
 * and that one is pointer events, not the platform's drag and drop. The two do
 * not meet: this only ever listens for a drag that started outside the map.
 */

/** A payload line that is already a link: `[[Note]]`, `[label](Note)`, `![[x]]`. */
const ALREADY_A_LINK = /^!?\[\[[^\]]+\]\]$|^!?\[[^\]]*\]\([^)\s]+\)$/;

const NOTE_EXTENSION = /\.md$/i;

/**
 * An address rather than a path: `https://…`, `obsidian://…`, `file://…`.
 *
 * Asked before the path reading, and it has to be, because a web address can
 * end in `.md` -- `https://obsidian.md` is a home page whose last segment looks
 * exactly like a file name, and reading it as a path would write `[[obsidian]]`
 * into the note: a link to a note that does not exist. `mailto:` and its
 * bare-scheme cousins carry no `//` at all, so they are named separately.
 *
 * A Windows drive letter is not a scheme: `D:\…` has no `//` after the colon.
 */
const AN_ADDRESS = /^[a-z][a-z0-9+.-]*:\/\//i;
const A_BARE_SCHEME = /^(?:mailto|tel|data|javascript|obsidian):/i;

/**
 * The link one dropped line stands for, or null when it stands for nothing.
 *
 * Three shapes arrive here, and only the last two are worth guessing at:
 *
 * - a link the platform wrote for us (`[[Note]]`) -- kept exactly as it is,
 *   because the note may have written an alias into it;
 * - a vault path or a file name (`daily/9.24 Day9.md`, `9.24 Day9.md`) -- the
 *   base name is what a wikilink takes, and the folders are not part of it;
 * - anything else, which is not a note and is refused rather than turned into
 *   a link that goes nowhere.
 *
 * Only `.md` is taken. A picture, a PDF or a web address dropped on the map is
 * not a note, and a link card pointing at one is a card that opens nothing --
 * the same trap the file explorer's own drag would set.
 */
export function linkTextFromDrop(line: string): string | null {
	const text = line.trim();
	if (text === "") return null;
	if (ALREADY_A_LINK.test(text)) return text;
	if (AN_ADDRESS.test(text) || A_BARE_SCHEME.test(text)) return null;
	// A Windows path, a vault-relative path, or a bare file name. All three end
	// in the extension, which is what actually decides this.
	if (!NOTE_EXTENSION.test(text)) return null;
	const base = text.split(/[\\/]/).pop() ?? "";
	if (!NOTE_EXTENSION.test(base)) return null;
	const name = base.replace(NOTE_EXTENSION, "").trim();
	return name === "" ? null : `[[${name}]]`;
}

/**
 * Every note a dropped payload names, in order, without repeats.
 *
 * A payload is one line per item, and a drag of several files is several
 * lines. Blank lines are what a trailing newline looks like.
 */
export function linksFromDrop(payload: string): string[] {
	const out: string[] = [];
	for (const line of payload.split(/\r?\n/)) {
		const link = linkTextFromDrop(line);
		if (link !== null && !out.includes(link)) out.push(link);
	}
	return out;
}

/**
 * The line an ephemeral state is asking for, or null when it asks for none.
 *
 * Obsidian hands a line over this way -- the outline pane and a `[[note#head]]`
 * link both do -- and it is the one thing that says which card a caller means.
 * A state that is not an object, or that carries no line, is not a request this
 * view can answer, and is refused rather than treated as line 0.
 */
export function lineOfState(state: unknown): number | null {
	if (typeof state !== "object" || state === null) return null;
	const line = (state as { line?: unknown }).line;
	if (typeof line !== "number" || !Number.isFinite(line)) return null;
	return Math.max(0, Math.floor(line));
}

/** What the module needs of the view: the surface it listens on and reports to. */
export interface NoteDropHost {
	canvas: { viewport: HTMLElement };
	/**
	 * The note Obsidian is carrying right now, or null.
	 *
	 * Asked first, and it is the reliable answer for a drag that started in the
	 * file explorer: the payload of a platform drag cannot be read until the
	 * drop, and by then the drag is over.
	 */
	draggedNoteName(): string | null;
	/** Write these links in as cards, under this card or under the root. */
	dropNotes(texts: readonly string[], targetId: string | null): void;
}

/** What the platform wrote into the drag, when it wrote anything readable. */
function payloadText(ev: DragEvent): string {
	const data = ev.dataTransfer;
	if (!data) return "";
	// Asked before reading on purpose: `getData` throws in some browsers when
	// the drag is over, and an empty string is the answer either way.
	const types = Array.from(data.types ?? []);
	if (!types.includes("text/plain")) return "";
	try {
		return data.getData("text/plain") ?? "";
	} catch {
		return "";
	}
}

/**
 * Listen for a note being dropped on the map, and return the way to stop.
 *
 * The marked card follows the pointer, and uses the class the map's own drag
 * already uses for the same state -- a drop target is a drop target, and the
 * two must not look like two different things.
 */
export function attachNoteDrop(host: NoteDropHost): () => void {
	const viewport = host.canvas.viewport;
	let marked: HTMLElement | null = null;

	const mark = (el: HTMLElement | null): void => {
		if (marked === el) return;
		marked?.removeClass("is-drop-target");
		marked = el;
		marked?.addClass("is-drop-target");
	};

	/** The card under the pointer, or null for the canvas itself. */
	const cardUnder = (ev: DragEvent): HTMLElement | null => {
		const target = ev.target;
		if (!(target instanceof HTMLElement)) return null;
		return target.closest<HTMLElement>(".mm-node");
	};

	const onDragOver = (ev: DragEvent): void => {
		// Nothing readable during a drag but the *kinds* of thing carried, so
		// the question here can only be "is this text at all". What it says is
		// decided at the drop, where it can be read.
		const data = ev.dataTransfer;
		if (!data || !Array.from(data.types ?? []).includes("text/plain")) return;
		ev.preventDefault();
		data.dropEffect = "copy";
		mark(cardUnder(ev));
	};

	const onDragLeave = (ev: DragEvent): void => {
		// Only when the pointer has left the map rather than moved between two
		// cards: the related target is where it went, and it is inside the
		// viewport for every move within the map.
		const to = ev.relatedTarget;
		if (to instanceof Node && viewport.contains(to)) return;
		mark(null);
	};

	const onDrop = (ev: DragEvent): void => {
		const card = cardUnder(ev);
		mark(null);
		const text = payloadText(ev);
		const payloadTexts = linksFromDrop(text);
		// The platform's own record of the drag outlives the drag, so it is
		// asked first and used alone when it answers: reading its path is not
		// guessing at what a payload meant.
		const dragged = host.draggedNoteName();
		const texts = dragged === null ? payloadTexts : [dragged];
		if (texts.length === 0) return;
		ev.preventDefault();
		host.dropNotes(texts, card?.dataset.id ?? null);
	};

	viewport.addEventListener("dragover", onDragOver);
	viewport.addEventListener("dragleave", onDragLeave);
	viewport.addEventListener("drop", onDrop);
	return () => {
		mark(null);
		viewport.removeEventListener("dragover", onDragOver);
		viewport.removeEventListener("dragleave", onDragLeave);
		viewport.removeEventListener("drop", onDrop);
	};
}
