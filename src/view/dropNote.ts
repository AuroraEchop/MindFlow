/**
 * Dropping something onto the map.
 *
 * A note dragged out of the file explorer and let go over the map becomes a
 * card on it: `[[Note]]`, written into the note the map is showing, as a child
 * of whatever card it was dropped on -- or of the root when it was dropped on
 * empty canvas. The card then opens its own outline, because a reader who
 * dragged a note here asked to read it, not to be handed a link to press.
 *
 * A link dragged out of a browser becomes a card too: `[what it was called](
 * https://…)`, or `[the site](https://…)` when the drag carried no words for
 * it. That one does not open an outline -- there is no outline to open -- but
 * it is a link card all the same, and the map already knows how to draw and
 * open one; see `linkCards.ts` and `cardLink`.
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
 * An address a browser opens: `http://` or `https://` and nothing else.
 *
 * This used to be refused here, on the grounds that a web address is not a
 * note and a card pointing at one opens nothing. That stopped being true when
 * link cards learned to draw a site -- a name, an address and a button that
 * hands it to the browser -- so the address is now the one *other* thing this
 * file turns into a card. Everything else with a scheme still is not.
 */
const A_WEB_ADDRESS = /^https?:\/\/\S+$/i;

/**
 * What a card's own link syntax cannot carry.
 *
 * `[label](target)` ends at the first `)`, so an address holding one -- or a
 * space, or a bracket -- would produce a card whose link stops early and opens
 * the wrong page. Such an address is refused rather than written wrong.
 */
const UNSAFE_IN_ADDRESS = /[()<>\s]/;

/** How much of a dragged label a card keeps before it trails off. */
const MAX_LABEL = 80;

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
 * What a site is called on a card: its host, without the `www.`.
 *
 * Read with `URL` rather than a pattern, so a host is a host rather than
 * whatever came between two slashes. Null when the address does not parse, or
 * parses as something a browser will not open.
 */
function hostOfAddress(address: string): string | null {
	try {
		const url = new URL(address);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		const host = url.hostname.replace(/^www\./i, "");
		return host === "" ? null : host;
	} catch {
		return null;
	}
}

/**
 * A dragged label, cleaned into something a card can say.
 *
 * `[` and `]` are the link's own syntax and would end the label early; a label
 * that is itself the address says nothing the card does not already show. Null
 * means "there was no useful name", and the caller falls back to the host.
 */
function cleanLabel(text: string | null): string | null {
	if (text === null) return null;
	const clean = text
		.replace(/[[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (clean === "") return null;
	if (A_WEB_ADDRESS.test(clean) || AN_ADDRESS.test(clean) || A_BARE_SCHEME.test(clean)) {
		return null;
	}
	return clean.length > MAX_LABEL ? `${clean.slice(0, MAX_LABEL).trimEnd()}…` : clean;
}

/**
 * A web address as the card that opens it: `[what it is called](https://…)`.
 *
 * `anchor` is the words the drag carried for the link -- dragging a word in a
 * page hands over that word, and it is a better name for the card than the
 * host is. A drag out of the address bar carries nothing but the address, and
 * the host is what a reader recognises there.
 *
 * Null for anything that is not an http(s) address, and for an address the
 * card's own link syntax cannot hold.
 */
export function webLinkFromDrop(
	address: string,
	anchor: string | null = null,
): string | null {
	const target = address.trim();
	if (!A_WEB_ADDRESS.test(target)) return null;
	if (UNSAFE_IN_ADDRESS.test(target)) return null;
	const host = hostOfAddress(target);
	if (host === null) return null;
	const label = cleanLabel(anchor) ?? host;
	return `[${label}](${target})`;
}

/**
 * The link one dropped line stands for, or null when it stands for nothing.
 *
 * Four shapes arrive here, and only the last three are worth guessing at:
 *
 * - a link the platform wrote for us (`[[Note]]`) -- kept exactly as it is,
 *   because the note may have written an alias into it;
 * - a web address (`https://…`) -- a link card the map can draw and open, so
 *   it is kept as the address it is, named by `anchor` when the drag carried
 *   a name for it;
 * - a vault path or a file name (`daily/9.24 Day9.md`, `9.24 Day9.md`) -- the
 *   base name is what a wikilink takes, and the folders are not part of it;
 * - anything else, which is not a note and is refused rather than turned into
 *   a link that goes nowhere.
 *
 * Only `.md` is taken as a path. A picture or a PDF dropped on the map is not
 * a note, and a link card pointing at one is a card that opens nothing -- the
 * same trap the file explorer's own drag would set.
 */
export function linkTextFromDrop(
	line: string,
	anchor: string | null = null,
): string | null {
	const text = line.trim();
	if (text === "") return null;
	if (ALREADY_A_LINK.test(text)) return text;
	if (A_WEB_ADDRESS.test(text)) return webLinkFromDrop(text, anchor);
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
 * The wikilink a note's name stands for, or null when it cannot be one.
 *
 * Asked of Obsidian's record of the drag rather than of the payload, because a
 * drag that started in the file explorer carries its file as a `Files` entry
 * and nothing readable at all -- no path, no name. The record has the name.
 * What it does not have is the link syntax, and that is the whole point of
 * this function: writing the bare name into the note makes a card that says
 * the note's name and *is* nothing -- no link to open, no preview, no outline,
 * and the drop looks like it only copied the title.
 *
 * `[`, `]`, `#`, `^` and `|` are the link's own syntax, and Obsidian refuses
 * them in a file name besides, so a name carrying one did not come from a note
 * and is refused rather than escaped into a link that means something else.
 */
export function linkForName(name: string): string | null {
	const trimmed = name.trim();
	if (trimmed === "") return null;
	if (/[[\]#^|]/.test(trimmed)) return null;
	return `[[${trimmed}]]`;
}

/**
 * Every link a dropped payload names, in order, without repeats.
 *
 * A payload is one line per item, and a drag of several files is several
 * lines. Blank lines are what a trailing newline looks like.
 *
 * `labels` is the second half of a link drag: a browser writes the addresses
 * into `text/uri-list` and the words they were called by into `text/plain`,
 * and the two are aligned line for line. They are only paired when both
 * accounts have the same number of lines -- an address dragged out of the
 * address bar has no label at all, and pairing it with whatever else was in
 * the payload would name the card after the wrong page.
 */
export function linksFromDrop(payload: string, labels = ""): string[] {
	const out: string[] = [];
	const lines = payload.split(/\r?\n/);
	const labelLines = labels.split(/\r?\n/);
	const aligned = labels !== "" && labelLines.length === lines.length;
	lines.forEach((line, index) => {
		const anchor = aligned ? labelLines[index] : null;
		const link = linkTextFromDrop(line, anchor);
		if (link !== null && !out.includes(link)) out.push(link);
	});
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
	 * The note Obsidian is carrying right now, as a link, or null.
	 *
	 * Asked as well as the payload rather than instead of it, and it is the
	 * answer for a drag that started in the file explorer: that payload is a
	 * `Files` entry with nothing readable in it, so the record is the only
	 * place the name is written down. The payload wins when it names something,
	 * because a drag of several notes says all of them there and the record
	 * only ever holds the one under the pointer.
	 */
	draggedNoteLink(): string | null;
	/** Write these links in as cards, under this card or under the root. */
	dropNotes(texts: readonly string[], targetId: string | null): void;
}

/** What the platform wrote into the drag, when it wrote anything readable. */
function payloadOf(ev: DragEvent, kind: string): string {
	const data = ev.dataTransfer;
	if (!data) return "";
	// Asked before reading on purpose: `getData` throws in some browsers when
	// the drag is over, and an empty string is the answer either way.
	const types = Array.from(data.types ?? []);
	if (!types.includes(kind)) return "";
	try {
		return data.getData(kind) ?? "";
	} catch {
		return "";
	}
}

function payloadText(ev: DragEvent): string {
	return payloadOf(ev, "text/plain");
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
		if (!data) return;
		const kinds = Array.from(data.types ?? []);
		// `Files` is what the file explorer's own drag carries, and it is the
		// one with no payload in it: the record of the drag is what answers for
		// it, and refusing it here would refuse the drag before the drop that
		// could have read it. Without this the platform never fires `drop` at
		// all -- a dragover that is not prevented is a drag nobody can drop.
		//
		// `text/uri-list` is what a browser writes for a link, and it is listed
		// beside `text/plain` because a drag out of the address bar carries the
		// address there and may carry nothing readable in the plain text.
		if (
			!kinds.includes("text/plain") &&
			!kinds.includes("text/uri-list") &&
			!kinds.includes("Files")
		) {
			return;
		}
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
		// The payload first, because it is what the drag itself said: a drag of
		// several notes lists them all, where the record below holds only the
		// one the pointer happened to be over.
		//
		// A link drag writes the addresses into `text/uri-list` and their names
		// into `text/plain`, so the two are read together when the first one is
		// there; a note dragged out of the file explorer has no uri-list at all
		// and is read from the plain text, as it always was.
		const addresses = payloadOf(ev, "text/uri-list");
		const plain = payloadText(ev);
		const fromPayload =
			addresses.trim() === "" ? linksFromDrop(plain) : linksFromDrop(addresses, plain);
		const carried = host.draggedNoteLink();
		const texts = fromPayload.length > 0 ? fromPayload : carried === null ? [] : [carried];
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
