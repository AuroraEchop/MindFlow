/**
 * Reading the note a card points at.
 *
 * A card that is one link can show what the other note says, and hang that
 * note's outline under itself. Both need the file, and a paint cannot wait for
 * a file, so this is the one corner of the map that is asynchronous: a paint
 * asks for the note, draws that it is waiting, and the read that lands starts
 * another paint. Everything a paint needs is therefore held here rather than
 * on the view -- the cache of what has been read, what is in flight, what
 * failed, and the outline each open card is showing -- and the view hands this
 * object a narrow host so the two do not have to know each other's insides.
 */

import { MarkdownView, Notice, TFile } from "obsidian";
import type { App } from "obsidian";

import { t } from "../i18n.ts";

import type { MindNode, ParsedDoc } from "../model/types.ts";
import { EMBED_ID_MARK, embedFoldKeys, isEmbedId, projectOutline } from "../model/embedTree.ts";
import type { EmbedTree } from "../model/embedTree.ts";
import { cardIsAbout, cardLink, isExternalTarget } from "../model/noteName.ts";
import type { LayoutNode } from "../layout/tidyTree.ts";
import {
	LinkReadCache,
	clipPreview,
	missingNoteLabel,
	prepareLinkFile,
	siteOf,
} from "./linkPreview.ts";
import type { LinkPreview } from "./linkPreview.ts";
import type { LinkCardOptions } from "./nodes.ts";
// Type-only, so the import leaves nothing behind at runtime: the view owns this
// module, and a value import would make the two import each other.
import type { PaintReason } from "./MindmapView.ts";

/**
 * The card a note has not been read for yet.
 *
 * Shared rather than made per card: it is the same empty answer every time, and
 * a paint that made one per unread card would be allocating for the state that
 * means "nothing to draw".
 */
const NO_PREVIEW: LinkPreview = { lines: [], more: 0 };

/**
 * What one read of another note is remembered and deduplicated under.
 *
 * The stamp is in the key, so a file that has changed is a different key as well
 * as a different entry -- a read still in flight for the old version cannot land
 * on the new one's slot. The separator is a character no path may hold, because
 * a path with a space in it must not be able to look like another path's stamp.
 */
function readKey(path: string, stamp: number): string {
	return `${path}\u0000${stamp}`;
}

/**
 * The outline one open link card is showing.
 *
 * The stamp is what makes the entry answerable when the source note changes:
 * the stamp is the one the outline was built from, and a file whose mtime has
 * moved on since is a file this tree is no longer a reading of.
 */
export interface Projection {
	tree: EmbedTree;
	path: string;
	stamp: number;
}

/**
 * What this module needs of the map it is reading notes for.
 *
 * Narrow on purpose: the file and the parse move on -- another note arrives,
 * the text is edited -- so those are asked for rather than held. The two
 * collections are shared by reference, because a fold seeded here has to land
 * in the set the rest of the map reads.
 */
export interface LinkCardHost {
	readonly app: App;
	/** The note the map is drawing. */
	currentFile(): TFile | null;
	/** The parse of it, or null before the first one. */
	currentDoc(): ParsedDoc | null;
	/** True once the view has gone, so a read that lands late does not paint. */
	isClosed(): boolean;
	/**
	 * The folded keys. Asked for rather than held, because a note that opens
	 * with a remembered shape replaces the whole set.
	 */
	collapsedKeys(): Set<string>;
	readonly layoutByKey: Map<string, LayoutNode>;
	paint(reason: PaintReason): void;
	markAnchor(key: string | undefined): void;
	layoutFor(id: string): LayoutNode | null;
	/** The node a card is drawn from: a node of the note, or a card of its prose. */
	cardNodeFor(id: string): MindNode | null;
	revealLine(view: MarkdownView, line: number): void | Promise<void>;
}

export class LinkCards {
	private readonly host: LinkCardHost;

	/**
	 * Cards showing what a link points at: the card's key, and the target it
	 * is showing.
	 *
	 * Not folded into `collapsedKeys`: that set means the opposite of this one
	 * -- a card the user shut against a card they opened -- and `isDefaultFold`
	 * compares it by size against the fold-to-depth seed, so a card's worth of
	 * foreign keys in there would make every note with a link on it look
	 * hand-folded.
	 *
	 * The target is kept beside the key because the key is a place rather than
	 * a card, so an entry has to be checked against the card actually drawn
	 * under it before it is believed -- see `held`.
	 */
	private readonly previews = new Map<string, string>();
	/**
	 * Link cards with the other note's outline open under them: the card's key,
	 * and the link whose outline it is.
	 *
	 * Separate from `previews` because the two are separate decisions: a
	 * card can show what the note says without showing its shape, and the shape
	 * without the words. A card with only this one open draws its title, its
	 * arrow, and somebody else's tree.
	 *
	 * The link is kept beside the key for the reason `previews` gives, and it
	 * matters more here: a projection is a whole subtree, so one left hanging
	 * under a card that never opened it is a branch of another note sitting in
	 * the middle of this map. `null` is a key restored from the last session
	 * whose card has not been drawn yet -- a note-content card's text is rebuilt
	 * from the note's lines at paint time -- so the first paint that draws it is
	 * what binds the entry to the card in front of it. See `held`.
	 */
	private openEmbeds = new Map<string, string | null>();
	/**
	 * What has been read of the notes other cards point at.
	 *
	 * `paint` is synchronous and reading a file is not, so the text has to live
	 * somewhere a paint can find it: a card whose note has not arrived draws
	 * that it is waiting, the read lands, and the paint after it draws the note.
	 * Keyed by path and stamped with the file's mtime, so an edit made anywhere
	 * else is noticed without anything having to tell this cache about it.
	 */
	private readonly reads = new LinkReadCache();
	/** Reads in flight, so one slow note is not asked for on every paint. */
	private readonly reading = new Set<string>();
	/** Paths whose read failed, so a card can say the note is gone. */
	private readonly unreadable = new Set<string>();
	/**
	 * The outline each open link card is showing, by that card's own key.
	 *
	 * Built once per card rather than per paint, because the ids in it carry the
	 * link node's id and the branches carry keys a fold is stored under. The
	 * source path and stamp ride along so a change to the note being projected
	 * can throw the right entries away -- see `forgetRead`.
	 */
	private readonly projections = new Map<string, Projection>();

	constructor(host: LinkCardHost) {
		this.host = host;
	}

	// --- what the map itself asks ------------------------------------------

	/** The cards showing a preview, in the order they were opened. */
	previewKeys(): string[] {
		return [...this.previews.keys()];
	}

	/** How many cards are showing a preview. */
	previewCount(): number {
		return this.previews.size;
	}

	/** The cards with somebody else's outline open under them. */
	embedKeys(): string[] {
		return [...this.openEmbeds.keys()];
	}

	/** How many cards have an outline open. */
	embedCount(): number {
		return this.openEmbeds.size;
	}

	/**
	 * Another note is being drawn: everything card-shaped goes.
	 *
	 * The reads stay. They are keyed by path and stamped, and the note now
	 * arriving may well point at the same files -- whereas a projection carries
	 * ids built from a link node of the note being left behind.
	 */
	reset(): void {
		this.previews.clear();
		this.openEmbeds.clear();
		this.projections.clear();
	}

	/**
	 * The cards that were left open come back open.
	 *
	 * What each one is showing is worked out again from the note rather than
	 * remembered -- see `seedFolds` -- so this is given the pairs the store
	 * held, already vetted against the parse. A title card's pair carries its
	 * link, read off the card; a note-content card's carries none, because its
	 * text is not in the parse to be read here, and the paint that draws it is
	 * what reads it.
	 */
	restore(
		previews: readonly [string, string][],
		embeds: readonly [string, string | null][],
	): void {
		this.previews.clear();
		for (const [key, target] of previews) this.previews.set(key, target);
		// What they were showing is not remembered, and would be stale anyway: a
		// projection is a reading of a file, and the file has had a night to
		// change. Dropping them is what makes the next paint build each one again
		// from a fresh read.
		this.openEmbeds = new Map(embeds);
		this.projections.clear();
	}

	/**
	 * Drop the open cards whose key no longer names a link card.
	 *
	 * The test is handed in because only the map knows what a key names: a card
	 * that has gone, or one whose text has stopped being a link, has nothing
	 * left to open onto.
	 */
	prune(stale: (key: string) => boolean): void {
		for (const key of [...this.previews.keys()]) {
			if (stale(key)) this.previews.delete(key);
		}
		for (const key of [...this.openEmbeds.keys()]) {
			if (stale(key)) {
				this.openEmbeds.delete(key);
				this.projections.delete(key);
			}
		}
	}

	// --- reading ------------------------------------------------------------

	/**
	 * The note a link target names, or null when nothing answering to it is a
	 * note.
	 *
	 * `getFirstLinkpathDest` rather than a path lookup, because a link is written
	 * as the shortest text that finds its note: Obsidian's own resolution is the
	 * only one that agrees with Obsidian's own links. The heading or block
	 * reference comes off first -- it is part of the link, not of the file.
	 *
	 * Markdown only, and that is what keeps the feature small. A card pointing at
	 * a picture or a PDF is already a card pointing at a picture or a PDF:
	 * clicking it opens it, which is what the map has always done with one, and
	 * inventing a preview for each kind of file would be inventing one per kind
	 * of file. Null here means "not a note", and such a card keeps the one-line
	 * shape it has today.
	 */
	private linkFile(target: string, cache: Map<string, TFile | null>): TFile | null {
		const hit = cache.get(target);
		if (hit !== undefined) return hit;
		// `[a](My%20Note.md)` and `[[My Note.md]]` are the same file; only the
		// first arrives encoded.
		let decoded = target;
		try {
			decoded = decodeURIComponent(target);
		} catch {
			// A stray `%` is not an escape. Take the target as written.
		}
		const linkpath = decoded.split("#")[0].split("^")[0];
		const found = this.host.app.metadataCache.getFirstLinkpathDest(
			linkpath,
			this.host.currentFile()?.path ?? "",
		);
		const file = found !== null && found.extension === "md" ? found : null;
		cache.set(target, file);
		return file;
	}

	// --- what a card has open -----------------------------------------------

	/**
	 * The link this card has open, once the card has been asked whether it is
	 * still the card that opened it -- or null, with the entry given up on.
	 *
	 * Both of the maps above are keyed by a card's *place*, and a place is not a
	 * card: a title card is stored under its own text, but a note-content card
	 * is stored under `ownerKey + mark + index`, which is the slot the note puts
	 * a block in and not the block that is in it. Believed against the key
	 * alone, an entry therefore outlives the card it was made for -- move a
	 * block out of a link card's place and whatever block takes the place over
	 * is handed that card's projection or preview, which is a card nothing was
	 * ever opened on, and which cannot even be shut: it is not a link, so it
	 * draws no arrow to press. That is the whole of the bug this asks about.
	 *
	 * `prune` cannot answer it. A note-content card is not in the parsed tree,
	 * so there is no text there to read and the entry is deliberately left for
	 * the paint that draws the card -- which is here, the one place the card is
	 * in hand.
	 *
	 * An entry that fails is dropped rather than kept to be asked about again:
	 * the map is drawn from what is left, and a card that has to be opened again
	 * is the cheaper half of the bargain against another note's outline sitting
	 * under a card that never named it.
	 *
	 * `null` in the map is a restored entry whose card has not been read yet --
	 * a note-content card's text is rebuilt from the note's lines at paint time,
	 * so the first paint that draws it is where the link is finally knowable,
	 * and a card that is one link names it. That is the same question asked the
	 * other way round: not "is this still that link" but "which link is this".
	 */
	private held(
		state: Map<string, string | null>,
		node: MindNode,
		sole: boolean,
	): string | null {
		const held = state.get(node.key);
		if (held === undefined) return null;

		// A card drawn from another note is another note's card, whatever its
		// text says -- the same refusal `cardPreviewFor` makes -- so it is not
		// the card any of this was opened on.
		if (isEmbedId(node.id)) {
			state.delete(node.key);
			return null;
		}
		const own = cardLink(node.text);

		if (held === null) {
			// Nothing to bind the entry to: a card that is not one link cannot
			// say which of its links was meant, and an address has no note
			// behind it for an outline to be read from.
			if (own === null || (sole && own.external)) {
				state.delete(node.key);
				return null;
			}
			state.set(node.key, own.target);
			return own.target;
		}

		if (!cardIsAbout(node.text, held, sole)) {
			state.delete(node.key);
			return null;
		}
		return held;
	}

	/**
	 * What this card has open as a projection, or null.
	 *
	 * The embeds half of `held`, and the tree goes with the state: a projection
	 * is nodes whose ids were built from the link card's id, so one held past
	 * its card is another note's outline hung under a card that no longer names
	 * it. Nothing is lost by dropping it -- what it was built from is in the
	 * read cache, so reopening builds it again without reading anything twice.
	 */
	private openProjection(node: MindNode): string | null {
		const target = this.held(this.openEmbeds, node, true);
		if (target === null) this.projections.delete(node.key);
		return target;
	}

	/**
	 * What a card should draw about a link, or null when it has none.
	 *
	 * Asked once per card per paint, out of the read cache, and it is the only
	 * place the two halves of a card's state are read together: whether the card
	 * is open, and whether what it is open onto has arrived. A paint must not
	 * wait on a file, so the answer for a note that has not been read yet is
	 * "loading" -- and asking for the read is what this does about it.
	 *
	 * Two questions, and they are separate. The **buttons** in the title are for
	 * a card that *is* one link -- a card of the note's own prose mentions links
	 * without being one, so a button there would have to guess which of them it
	 * meant, and an outline can only be hung under a card that names a single
	 * note. The **preview** is what the card is showing, which is its own link
	 * when the card is one and whichever link was pressed when it is not.
	 *
	 * Both are asked of the card in front of this paint and not of the key it
	 * was stored under -- see `held` -- which is what keeps an open card's
	 * state from changing hands when the note moves a block around under it.
	 */
	cardPreviewFor(
		node: MindNode,
		maxLines: number,
		cache: Map<string, TFile | null>,
	): LinkCardOptions | null {
		// A card that came out of another note is not a link card of this map,
		// whatever its text says. Reading one note through another note's links
		// is a second feature -- it needs a projection of a projection, and a
		// fold that survives a re-parse of a file this map only reads -- and
		// drawing an arrow that answered to nothing would be worse than drawing
		// none. Such a card keeps the shape it has.
		const own = isEmbedId(node.id) ? null : cardLink(node.text);
		const open = this.held(this.previews, node, false) !== null;

		if (own === null && !open) return null;
		const arrow = own !== null && !own.external;
		const subtreeOpen = this.openProjection(node) !== null;
		const closed: LinkCardOptions = {
			oneLink: own !== null,
			arrow,
			subtreeOpen,
			preview: null,
			read: null,
			site: null,
			footer: "note",
		};

		if (!open) return closed;

		// A card that is one link always shows that link, read back off the card
		// itself -- so rewriting the link changes what the card shows without
		// anything having to notice. The stored target is for the other case.
		const target = own?.target ?? this.previews.get(node.key) ?? null;
		if (target === null) return closed;

		if (isExternalTarget(target)) {
			return { ...closed, preview: NO_PREVIEW, read: "ready", site: siteOf(target), footer: "site" };
		}

		const file = this.linkFile(target, cache);
		if (file === null) {
			return { ...closed, preview: NO_PREVIEW, read: "missing" };
		}

		const stamp = file.stat.mtime;
		const read = this.reads.get(file.path, stamp);
		if (read === null) {
			this.requestRead(file);
			const failed = this.unreadable.has(readKey(file.path, stamp));
			return { ...closed, preview: NO_PREVIEW, read: failed ? "missing" : "loading" };
		}
		return { ...closed, preview: clipPreview(read.preview, maxLines), read: "ready" };
	}

	/**
	 * Ask for the text of another note, once, and repaint when it lands.
	 *
	 * A paint that needs a file it does not have starts the read and draws the
	 * wait; the paint that follows the read draws the note. Asking twice is free
	 * because the second ask is not made -- a map with twenty cards pointing at
	 * one note would otherwise read it twenty times over.
	 *
	 * `cachedRead` and not `read`: this is a note somewhere else in the vault
	 * that nobody is editing through the map, and Obsidian's own cache is
	 * already holding the last version of it.
	 */
	private requestRead(file: TFile): void {
		const key = readKey(file.path, file.stat.mtime);
		if (this.reading.has(key) || this.unreadable.has(key)) return;
		this.reading.add(key);
		void this.host.app.vault.cachedRead(file).then(
			(text) => {
				this.reading.delete(key);
				this.reads.put(file.path, prepareLinkFile(text, file.stat.mtime));
				if (!this.host.isClosed()) this.host.paint("link");
			},
			(error: unknown) => {
				// The file can be deleted between the ask and the answer. Nothing
				// to say about it: the card says the note is not there, which is
				// now true.
				this.reading.delete(key);
				this.unreadable.add(key);
				console.debug("MindFlow: could not read the linked note.", error);
				if (!this.host.isClosed()) this.host.paint("link");
			},
		);
	}

	/**
	 * Another note changed under the maps that are reading it.
	 *
	 * The read cache is stamped, so it needs nothing done to it -- a new mtime is
	 * a miss. What needs throwing away is the tree built from the old text: it is
	 * a set of nodes with ids and keys of its own, and the cards drawn from it
	 * would otherwise go on saying what the note said before it was edited.
	 */
	forgetRead(path: string): void {
		this.reads.forget(path);
		for (const key of [...this.unreadable]) {
			if (key.startsWith(`${path}\u0000`)) this.unreadable.delete(key);
		}
		let dropped = false;
		for (const [key, projection] of [...this.projections]) {
			if (projection.path !== path) continue;
			this.projections.delete(key);
			dropped = true;
		}
		if (dropped) this.host.paint("link");
	}

	// --- opening and closing ------------------------------------------------

	/**
	 * The outline an open card is showing, or null when it is not an open one.
	 *
	 * Called for every node on every paint, so the first question is the cheap
	 * one. Building happens here rather than at the press because a press often
	 * arrives before the file does: the read lands, the paint that follows asks
	 * again, and the branch appears then.
	 */
	projectionFor(node: MindNode): Projection | null {
		if (this.openProjection(node) === null) return null;
		const held = this.projections.get(node.key);
		if (held !== undefined) return held;
		this.buildProjection(node);
		return this.projections.get(node.key) ?? null;
	}

	/** Build one card's projection, if the note behind it has been read. */
	private buildProjection(node: MindNode): void {
		const own = cardLink(node.text);
		if (own === null || own.external) return;
		const file = this.linkFile(own.target, new Map());
		if (file === null) return;

		const stamp = file.stat.mtime;
		const read = this.reads.get(file.path, stamp);
		if (read === null) {
			this.requestRead(file);
			return;
		}

		// The link node takes the place of the source note's own root card: a
		// note's map draws its title at the centre, and this card is already
		// saying what that title is.
		const tree = projectOutline(node, read.outline);
		this.projections.set(node.key, { tree, path: file.path, stamp });
		this.seedEmbedFold(tree);
	}

	/**
	 * Open the arrow onto the other note's top level, and no deeper.
	 *
	 * The shape the rest of the map opens in, asked of the projection instead of
	 * the note: the sections showing, each one closed. A projection that arrived
	 * fully unfolded would not be a preview of a note, it would be the note.
	 *
	 * A fold the user then makes inside a projection stays for the session and is
	 * not written down. `seedFolds` drops any remembered key that is not in the
	 * tree, and a projected key is never in this note's tree -- so keeping it
	 * would mean keeping one that is thrown away on the next open anyway, and
	 * losing a fold inside somebody else's outline is the cheapest thing this
	 * feature has to lose.
	 */
	private seedEmbedFold(tree: EmbedTree): void {
		const folded = this.host.collapsedKeys();
		for (const key of embedFoldKeys(tree)) folded.add(key);
	}

	/**
	 * Open or close what a card is showing about a note it points at.
	 *
	 * Closing comes first and asks nothing about the card's text. A card of the
	 * note's own prose shows whichever of its links was pressed -- see
	 * `previewLink` -- so it is not a link card, and yet the block under it has
	 * to be put away like any other; the button heading that block is the only
	 * way out of it, because a card holding three links has no one link a title
	 * button could name. Opening is the narrower half: it is only for a card
	 * that *is* one link, since which of a paragraph's links is meant is only
	 * knowable from the press.
	 *
	 * A press anywhere else on the card does neither. Picking a card has to mean
	 * one thing on every card in the map, or a card stops being a thing you can
	 * pick up without losing something.
	 *
	 * A state rather than a hover: what a note says is worth reading, and
	 * reading takes longer than a pointer stays still.
	 */
	toggleCardPreview(id: string): void {
		const node = this.host.cardNodeFor(id);
		if (!node) return;
		if (this.previews.has(node.key)) {
			this.previews.delete(node.key);
		} else {
			const own = isEmbedId(node.id) ? null : cardLink(node.text);
			if (own === null) return;
			this.previews.set(node.key, own.target);
		}
		this.host.markAnchor(node.key);
		this.host.paint("link");
	}

	/**
	 * Open a link from inside a card that is not itself one.
	 *
	 * What a press on a link in a note's own prose does now. It used to hand the
	 * target to the workspace and leave the map, which is the one thing the
	 * card's own link no longer does -- and a reader who pressed a link to see
	 * where it went should not lose their place for asking. `Ctrl`/`Cmd`+click
	 * is what still goes there, and is asked before this is.
	 */
	previewLink(id: string, target: string): void {
		const node = this.host.cardNodeFor(id);
		if (!node) return;
		this.previews.set(node.key, target);
		this.host.markAnchor(node.key);
		this.host.paint("link");
	}

	/**
	 * Open or close the other note's outline under this card.
	 *
	 * The arrow's own press, and nothing is written anywhere: what the
	 * projection is made of is read out of the file, and the file is not touched.
	 */
	toggleEmbed(id: string): void {
		const node = this.host.cardNodeFor(id);
		if (!node) return;
		const own = isEmbedId(node.id) ? null : cardLink(node.text);
		if (own === null) return;

		if (this.openEmbeds.has(node.key)) {
			this.openEmbeds.delete(node.key);
			// The tree goes with it: ids built from this card's id, and keys a
			// fold could still be holding. Reopening builds it again from a read
			// that is already in the cache, so nothing is lost by dropping it.
			this.projections.delete(node.key);
			this.host.markAnchor(node.key);
			this.host.paint("fold");
			return;
		}

		// An address has no outline: there is no file to read, and the card's
		// own press is what opens it instead.
		if (own.external) return;

		if (this.linkFile(own.target, new Map()) === null) {
			new Notice(missingNoteLabel(own.target));
			return;
		}

		// The link the outline was opened on is kept beside the key, because the
		// key alone is a place and a place can change hands -- see `held`.
		this.openEmbeds.set(node.key, own.target);
		this.host.markAnchor(node.key);
		// Built before the paint when the note is already in hand, so the branch
		// arrives in one step rather than two. When it is not, the read is
		// started here and the branch arrives with it.
		this.buildProjection(node);

		const projection = this.projections.get(node.key);
		if (projection !== undefined && projection.tree.roots.length === 0) {
			this.openEmbeds.delete(node.key);
			this.projections.delete(node.key);
			new Notice(t("view.link.noOutline"));
			return;
		}
		this.host.paint("fold");
	}

	// --- the cards drawn from another note ----------------------------------

	/**
	 * The projected node a card's id stands for, or null.
	 *
	 * Resolved through the layout rather than through an index of its own: a
	 * projected node is only ever on screen because a paint put it there, and the
	 * paint's own index is the record of that.
	 */
	projectedNodeFor(id: string): MindNode | null {
		if (!isEmbedId(id)) return null;
		return this.host.layoutFor(id)?.node ?? null;
	}

	/**
	 * Where a projected card's text was written: the note it came from.
	 *
	 * Walked back up the key rather than kept in a map, because the chain is
	 * already in the key: a projected key is the link card's key, the mark, and
	 * the source note's own text path. The card that did the projecting is what
	 * knows the target -- and it may be a note-content card, which is not in the
	 * parsed tree, so it is looked up wherever a card of that key could be.
	 */
	embedSourceOf(id: string): { path: string; line: number } | null {
		const node = this.projectedNodeFor(id);
		if (node === null || node.lineStart < 0) return null;
		const mark = node.key.indexOf(EMBED_ID_MARK);
		if (mark < 0) return null;
		const linkKey = node.key.slice(0, mark);
		const link =
			this.host.currentDoc()?.byKey.get(linkKey) ??
			this.host.layoutByKey.get(linkKey)?.node ??
			null;
		const own = link ? cardLink(link.text) : null;
		if (own === null) return null;
		const file = this.linkFile(own.target, new Map());
		return file === null ? null : { path: file.path, line: node.lineStart };
	}

	/**
	 * Open the note a projected card was read from, at the line it was read from.
	 *
	 * In a new tab, and that is the whole reason this is not `revealInNote`.
	 * `revealInNote` gives up the current tab because the card and the line are
	 * the same note's; a projected card's line is somebody else's, and following
	 * it in place would close the map the user was reading. The line is revealed
	 * through the same helper the note-to-map direction uses, so a caret arrives
	 * where it arrives anywhere else.
	 */
	async openSourceNote(path: string, line: number): Promise<void> {
		const file = this.host.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		const leaf = this.host.app.workspace.getLeaf("tab");
		await leaf.openFile(file);
		const view = leaf.view;
		if (view instanceof MarkdownView && line >= 0) await this.host.revealLine(view, line);
	}
}
