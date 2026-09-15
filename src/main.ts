import { MarkdownView, Notice, Plugin, TFile, TFolder, debounce, setIcon } from "obsidian";
import type { ViewState, WorkspaceLeaf } from "obsidian";

import { MINDMAP_VIEW_TYPE, MindmapView } from "./view/MindmapView.ts";
import { EXPORT_COMMANDS } from "./export/run.ts";
import { resolveLanguage, setLanguage, t } from "./i18n.ts";
import { DEFAULT_SETTINGS, MindmapSettingTab } from "./settings.ts";
import type { MindmapSettings } from "./settings.ts";
import {
	forgetFolder,
	forgetNote,
	putNoteState,
	readStore,
	renameFolder,
	renameNote,
} from "./foldStore.ts";
import type { FoldStore, NoteViewEntry, NoteViewState } from "./foldStore.ts";
import {
	UPDATE_NOTICE_MS,
	shouldAnnounce,
	updateNotice,
	versionToRecord,
} from "./updateNotice.ts";
import { parkUndo, recordExternalEdit, takeUndo } from "./undoPark.ts";
import type { ParkedUndo, UndoStacks } from "./undoPark.ts";

const HEADER_BUTTON_CLASS = "mindmap-mode-toggle";

/** Where the fold store sits in `data.json`, beside the flat settings. */
const FOLD_STATE_KEY = "foldState";

/** Where the notes that open as maps sit, under their own reserved key. */
const MAP_NOTES_KEY = "mapNotes";

/**
 * How many notes that list keeps.
 *
 * The same budget the fold store uses, and for the same reason: a vault is
 * worked in for years, and a list that only ever grows is a file that only ever
 * gets slower to load.
 */
const MAP_NOTES_LIMIT = 200;

/** Where the last version this vault ran sits, beside the other two. */
const VERSION_KEY = "lastSeenVersion";

/**
 * How long a fold change waits before it reaches disk.
 *
 * Every toggle, expand-all and selection move asks to be saved, and a user
 * walking a big map does that a few times a second. Long enough to collapse a
 * burst into one write, short enough that a crash loses a click, not an hour.
 */
const FOLD_SAVE_DELAY = 800;

export default class MindmapPlugin extends Plugin {
	override settings: MindmapSettings = { ...DEFAULT_SETTINGS };

	/** Fold and focus state per note path. Shares `data.json` with the settings. */
	private foldStore: FoldStore = {};

	/** The version of the plugin this vault last loaded, or null if none is kept. */
	private lastSeenVersion: string | null = null;

	/** Whether `data.json` held no settings, which is a first install. */
	private freshInstall = false;

	/** The last map's undo history, for the next view that shows the same note. */
	private parkedUndo: ParkedUndo | null = null;

	/** The note a read is in flight for, so two cannot land out of order. */
	private readingFor: string | null = null;

	/**
	 * A line the next map is to put its selection on, and the note it belongs
	 * to. Keyed by path so a map that loads some other note leaves it alone.
	 */
	private pendingReveal: { path: string; line: number } | null = null;

	/** Notes this session has been left showing as a map. */
	private mapNotes = new Set<string>();

	/**
	 * The same list as a previous session left it, read only in `always` mode.
	 *
	 * Kept apart from the session set rather than merged into it, because
	 * switching the setting from `always` to `session` has to stop reopening
	 * yesterday's notes without losing the record of them.
	 */
	private storedMapNotes: string[] = [];

	/**
	 * The markdown view state a leaf had before it became a map, so toggling
	 * back returns to reading or source mode exactly as the user left it.
	 */
	private readonly previousState = new WeakMap<WorkspaceLeaf, ViewState>();

	private readonly queueSave = debounce(
		() => void this.savePluginData(),
		FOLD_SAVE_DELAY,
		false,
	);

	override async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			MINDMAP_VIEW_TYPE,
			(leaf) => new MindmapView(leaf, this),
		);

		this.addSettingTab(new MindmapSettingTab(this.app, this));

		this.addRibbonIcon("git-fork", t("view.action.toggleView"), () => {
			const leaf = this.app.workspace.getMostRecentLeaf();
			if (leaf) void this.toggleLeaf(leaf);
		});

		this.addCommand({
			id: "toggle-mindmap-view",
			name: t("view.action.toggleView"),
			checkCallback: (checking) => {
				const leaf = this.app.workspace.getMostRecentLeaf();
				if (!leaf || !this.isToggleable(leaf)) return false;
				if (!checking) void this.toggleLeaf(leaf);
				return true;
			},
		});

		this.addCommand({
			id: "forget-fold-state",
			name: t("command.forgetFold"),
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MindmapView);
				const path = view?.file?.path;
				if (!view || !path) return false;
				if (!checking) {
					this.forgetNoteState(path);
					view.resetFolds();
				}
				return true;
			},
		});

		// No default hotkey: the map already takes Ctrl/Cmd+F for itself while it
		// has the keyboard, and claiming it globally would show up as a conflict
		// against Obsidian's own search in every other view.
		this.addCommand({
			id: "search-mindmap",
			name: t("command.search"),
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MindmapView);
				if (!view) return false;
				if (!checking) view.openSearch();
				return true;
			},
		});

		// No default hotkeys: the map answers Ctrl/Cmd+Up and Ctrl/Cmd+Down itself
		// while it holds the keyboard, and a command bound to the same pair would
		// run on the same keypress -- moving the node two places instead of one.
		// These are here to be rebound, and for the palette.
		const moveCommandKeys = { up: "command.moveUp", down: "command.moveDown" } as const;
		for (const direction of ["up", "down"] as const) {
			this.addCommand({
				id: `move-node-${direction}`,
				name: t(moveCommandKeys[direction]),
				checkCallback: (checking) => {
					const view = this.app.workspace.getActiveViewOfType(MindmapView);
					if (!view?.canMoveSelection(direction)) return false;
					if (!checking) view.moveSelection(direction);
					return true;
				},
			});
		}

		// Gated on the map being the view in front, like the other map commands:
		// there is nothing to export anywhere else. A map that has not been
		// painted yet still offers them and says so when asked, rather than
		// having the entries appear and disappear as a note is opened.
		for (const entry of EXPORT_COMMANDS) {
			this.addCommand({
				id: entry.id,
				name: t(entry.nameKey),
				checkCallback: (checking) => {
					const view = this.app.workspace.getActiveViewOfType(MindmapView);
					if (!view) return false;
					if (!checking) view.exportAs(entry.format);
					return true;
				},
			});
		}

		this.addCommand({
			id: "open-as-mindmap",
			name: t("command.openAsMindmap"),
			checkCallback: (checking) => {
				const leaf = this.app.workspace.getMostRecentLeaf();
				if (!leaf || leaf.view.getViewType() !== "markdown") return false;
				if (!checking) void this.setMindmapView(leaf);
				return true;
			},
		});

		// The note's half of the round trip Ctrl/Cmd+click starts from the map:
		// open the map on the card the caret is sitting in. Bound to nothing by
		// default -- it is here for the palette, and to be rebound.
		this.addCommand({
			id: "reveal-line-on-the-map",
			name: t("command.revealLineOnMap"),
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				const leaf = this.app.workspace.getMostRecentLeaf();
				if (!view?.file || !leaf || leaf.view.getViewType() !== "markdown") return false;
				if (!checking) {
					this.pendingReveal = {
						path: view.file.path,
						line: view.editor.getCursor().line,
					};
					void this.setMindmapView(leaf);
				}
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file, _source, leaf) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				const isMap = leaf?.view.getViewType() === MINDMAP_VIEW_TYPE;
				menu.addItem((item) =>
					item
						.setTitle(isMap ? t("view.action.editMarkdown") : t("view.action.openMap"))
						.setIcon(isMap ? "file-text" : "git-fork")
						.onClick(() => {
							if (leaf) void this.toggleLeaf(leaf);
							else void this.openFileAsMindmap(file);
						}),
				);
			}),
		);

		// A note that moves keeps its state; one that is deleted takes its state
		// with it. Neither is cosmetic -- without the first, reorganising a vault
		// quietly resets every map in it, and without the second the store fills
		// with entries for files nothing will ever open again.
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFolder) {
					this.updateStore(renameFolder(this.foldStore, oldPath, file.path));
				} else if (file instanceof TFile && file.extension === "md") {
					this.updateStore(renameNote(this.foldStore, oldPath, file.path));
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFolder) this.updateStore(forgetFolder(this.foldStore, file.path));
				else if (file instanceof TFile) this.forgetNoteState(file.path);
			}),
		);

		// A note this plugin is holding a history for can be written by something
		// that is not the map -- the markdown editor, a second window, a sync
		// client. Each of those is a step back, and it belongs on the same stack
		// as the map's own, or switching views would mean switching histories.
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && file.extension === "md") void this.trackExternalEdit(file);
			}),
		);

		// A note the user last left as a map opens as one again. Only when the
		// leaf is showing it as markdown, which is what a fresh open looks like
		// -- and what stops this from firing on the swap it has just made.
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!file || !this.markedAsMap(file.path)) return;
				const leaf = this.app.workspace.getMostRecentLeaf();
				if (!leaf || leaf.view.getViewType() !== "markdown") return;
				if ((leaf.view as { file?: TFile }).file?.path !== file.path) return;
				void this.setMindmapView(leaf);
			}),
		);

		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.refreshHeaderButtons()),
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => this.refreshHeaderButtons()),
		);
		this.app.workspace.onLayoutReady(() => {
			this.refreshHeaderButtons();
			// After layout: a notice raised while Obsidian is still starting up
			// competes with Obsidian's own, and the user is not looking yet.
			void this.reviewVersion();
		});
	}

	/**
	 * One notice per update, on the load that follows it, and a record of the
	 * version so the next load stays quiet.
	 *
	 * An update from the plugin browser is silent, and inline annotations redraw
	 * `: ` lines in notes the user already has -- so the change announces itself
	 * once rather than waiting to be noticed.
	 */
	private async reviewVersion(): Promise<void> {
		const current = this.manifest.version;
		if (shouldAnnounce(this.lastSeenVersion, current, this.freshInstall)) {
			new Notice(updateNotice(), UPDATE_NOTICE_MS);
		}
		const record = versionToRecord(this.lastSeenVersion, current);
		// Every ordinary load lands here with nothing to write.
		if (record === null) return;
		this.lastSeenVersion = record;
		await this.savePluginData();
	}

	override onunload(): void {
		// Obsidian is done with the plugin after this returns, so a fold change
		// still sitting on the debounce timer has to be spent now or lost.
		this.queueSave.run();
		this.removeHeaderButtons();
	}

	async loadSettings(): Promise<void> {
		// `loadData` is typed `any`; naming the shape here is what keeps an
		// unchecked spread from silently widening every setting to `any`.
		const stored = (await this.loadData()) as Record<string, unknown> | null;

		// The settings sit flat at the root of data.json and the fold store sits
		// beside them under one reserved key. Lifting it out before the spread is
		// what stops it riding into `this.settings` as an unrecognised setting --
		// which the next save would then write back inside itself, once per save.
		const { [FOLD_STATE_KEY]: folds, [VERSION_KEY]: seen, [MAP_NOTES_KEY]: maps, ...rest } =
			stored ?? {};
		this.foldStore = readStore(folds);
		this.lastSeenVersion = typeof seen === "string" ? seen : null;
		this.storedMapNotes = Array.isArray(maps)
			? maps.filter((path): path is string => typeof path === "string")
			: [];
		this.freshInstall = Object.keys(rest).length === 0;
		const merged = { ...DEFAULT_SETTINGS, ...(rest as Partial<MindmapSettings>) };
		// The spread is shallow, so a vault with no rebound shortcuts would share
		// the one object `DEFAULT_SETTINGS` holds -- and the first rebinding would
		// write itself into the defaults every other reader compares against.
		this.settings = { ...merged, shortcuts: { ...merged.shortcuts } };
		// Before anything paints: a view built while the plugin was still
		// speaking the fallback would have to be redrawn to catch up.
		this.applyLanguage();
	}

	/**
	 * Point the dictionary at whatever the setting resolves to.
	 *
	 * Called on load and again whenever the setting changes, and it is the only
	 * place the plugin's language is decided -- everything else reads `t`.
	 */
	applyLanguage(): void {
		setLanguage(resolveLanguage(this.settings.language));
	}

	async saveSettings(): Promise<void> {
		await this.savePluginData();
	}

	// --- remembered fold state ------------------------------------------------

	/**
	 * The one place data.json is written.
	 *
	 * Two things share the file now, and `saveData` replaces it wholesale, so a
	 * write that knew only about the settings would drop every note's fold state
	 * the first time somebody moved a slider.
	 */
	private async savePluginData(): Promise<void> {
		// Whatever the timer was going to write is in this write already, so a
		// settings change spends the pending fold save rather than racing it.
		this.queueSave.cancel();
		const version = this.lastSeenVersion === null ? {} : { [VERSION_KEY]: this.lastSeenVersion };
		await this.saveData({
			...this.settings,
			[FOLD_STATE_KEY]: this.foldStore,
			[MAP_NOTES_KEY]: this.storedMapNotes,
			...version,
		});
	}

	/** Swap the store and schedule a write, unless nothing actually changed. */
	private updateStore(next: FoldStore): void {
		if (next === this.foldStore) return;
		this.foldStore = next;
		this.queueSave();
	}

	/** What a note was left looking like, or null when nothing is remembered. */
	readNoteState(path: string): NoteViewState | null {
		if (!this.settings.rememberFolds) return null;
		return this.foldStore[path] ?? null;
	}

	writeNoteState(path: string, entry: NoteViewEntry): void {
		if (!this.settings.rememberFolds) return;
		this.updateStore(putNoteState(this.foldStore, path, entry, Date.now()));
	}

	/**
	 * Deliberately not gated on `rememberFolds`: the command has to be able to
	 * clear a stale entry left behind by a session where the setting was on.
	 */
	forgetNoteState(path: string): void {
		this.updateStore(forgetNote(this.foldStore, path));
	}

	// --- notes that open as a map ---------------------------------------------

	/** Whether the map is what this note should open as. */
	private markedAsMap(path: string): boolean {
		if (this.settings.rememberView === "off") return false;
		if (this.mapNotes.has(path)) return true;
		// The persisted list, and only when the user asked the mark to outlive
		// the session.
		return this.settings.rememberView === "always" && this.storedMapNotes.includes(path);
	}

	/**
	 * Record what a note was left showing.
	 *
	 * Called on every switch, not only when the mark changes, so that a note put
	 * back to markdown is forgotten in the stored list as well -- otherwise the
	 * mark would come back on the next load and reopen the note as a map the
	 * user had just left.
	 */
	private rememberView(path: string, asMap: boolean): void {
		if (asMap) {
			this.mapNotes.add(path);
			if (this.settings.rememberView !== "always") return;
			if (this.storedMapNotes.includes(path)) return;
			this.storedMapNotes = [...this.storedMapNotes, path].slice(-MAP_NOTES_LIMIT);
			this.queueSave();
			return;
		}

		this.mapNotes.delete(path);
		if (!this.storedMapNotes.includes(path)) return;
		this.storedMapNotes = this.storedMapNotes.filter((other) => other !== path);
		this.queueSave();
	}

	// --- undo history across a view swap --------------------------------------

	/**
	 * Keep a map's history, against the document it was recorded from.
	 *
	 * Called on every write rather than on the way out. The view is torn down in
	 * an order this cannot rely on, and `clear()` blanks `data` before the view
	 * is done -- so a hook on the way out can arrive with nothing left to record.
	 */
	parkUndo(path: string, data: string, undo: readonly string[], redo: readonly string[]): void {
		this.parkedUndo = parkUndo(path, data, undo, redo);
	}

	/**
	 * The history recorded for exactly this document, or null.
	 *
	 * `takeUndo` holds the rule and its reasoning; this only keeps the slot.
	 */
	adoptUndo(path: string, data: string): UndoStacks | null {
		const take = takeUndo(this.parkedUndo, path, data);
		this.parkedUndo = take.slot;
		return take.stacks;
	}

	/**
	 * Fold a change made outside the map into the history the map will come
	 * back to.
	 *
	 * The document has to be read to know what arrived, and a read is a turn of
	 * the event loop -- so a second one is not started while the first is still
	 * out. Two landing out of order would file the revisions backwards. The
	 * cost is a state nobody saw: the next save reads the newest document and
	 * files the step from wherever the history had got to, so the stack stays
	 * a coherent sequence even when it is not an exhaustive one.
	 */
	private async trackExternalEdit(file: TFile): Promise<void> {
		const slot = this.parkedUndo;
		if (!slot || slot.path !== file.path || this.readingFor !== null) return;
		this.readingFor = file.path;
		try {
			const data = await this.app.vault.read(file);
			// The slot can be replaced or spent while the read is out, and the
			// note it is holding is then not this one.
			const current = this.parkedUndo;
			if (!current || current.path !== file.path) return;
			this.parkedUndo = recordExternalEdit(current, data);
		} finally {
			this.readingFor = null;
		}
	}

	refreshAllViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof MindmapView) view.refresh();
		}
	}

	// --- switching between markdown and the map -------------------------------

	private isToggleable(leaf: WorkspaceLeaf): boolean {
		const type = leaf.view.getViewType();
		if (type === MINDMAP_VIEW_TYPE) return true;
		if (type !== "markdown") return false;
		const file = this.app.workspace.getActiveFile();
		return file?.extension === "md";
	}

	async toggleLeaf(leaf: WorkspaceLeaf): Promise<void> {
		if (leaf.view.getViewType() === MINDMAP_VIEW_TYPE) {
			await this.setMarkdownView(leaf);
		} else {
			await this.setMindmapView(leaf);
		}
	}

	/**
	 * Swap the view type on the leaf that is already showing the file.
	 *
	 * Nothing is created and nothing is copied: the same TFile stays open in the
	 * same tab, and the map reads and writes that file directly.
	 */
	async setMindmapView(leaf: WorkspaceLeaf): Promise<void> {
		const state = leaf.getViewState();
		const file = (leaf.view as { file?: TFile }).file;
		if (!file || file.extension !== "md") {
			new Notice(t("main.notice.onlyMarkdown"));
			return;
		}

		this.previousState.set(leaf, state);
		this.rememberView(file.path, true);
		await leaf.setViewState(
			{
				type: MINDMAP_VIEW_TYPE,
				state: { file: file.path },
				active: true,
			},
			{ focus: true },
		);
	}

	/**
	 * Swap back to the editor.
	 *
	 * `remember` is false for a switch the plugin made on the user's behalf.
	 * Ctrl/Cmd+clicking a card to see the line it is written on is a look at the
	 * note, not a decision to stop opening that note as a map.
	 */
	async setMarkdownView(leaf: WorkspaceLeaf, remember = true): Promise<void> {
		const file = (leaf.view as { file?: TFile }).file;
		if (remember && file) this.rememberView(file.path, false);
		const remembered = this.previousState.get(leaf);

		const next: ViewState = remembered
			? { ...remembered, active: true }
			: { type: "markdown", state: file ? { file: file.path } : {}, active: true };

		// The remembered state may point at a different note if the user navigated.
		if (remembered && file) {
			next.state = { ...(remembered.state ?? {}), file: file.path };
		}

		await leaf.setViewState(next, { focus: true });
	}

	/**
	 * The line a map loading this note is to select, or null.
	 *
	 * Taken once. A map that loads some other note leaves it standing rather
	 * than eating it -- the user asked for a card on the note they were reading,
	 * not on whichever note happened to open next.
	 */
	takeReveal(path: string): number | null {
		const pending = this.pendingReveal;
		if (!pending || pending.path !== path) return null;
		this.pendingReveal = null;
		return pending.line;
	}

	/**
	 * Put the caret on a line of the note a view is showing.
	 *
	 * Three things have to be true before a caret means anything, and not one of
	 * them is true the instant a view is created: the note has to have been
	 * read, the editor has to be in source mode -- reading view has no caret to
	 * put anywhere -- and only then does the scroll land where it was asked to.
	 *
	 * Which is why the wait is explicit and bounded rather than a guess at a
	 * delay: a caret set into an editor that has not read the note yet is
	 * thrown away with the load, and the note opens at the top. The bound is
	 * there so that a view which never loads is not something to hang on.
	 */
	async revealLine(view: MarkdownView, line: number): Promise<void> {
		if (view.getMode() !== "source") {
			await view.setState({ ...view.getState(), mode: "source" }, { history: false });
		}
		for (let attempt = 0; attempt < 30; attempt++) {
			if (view.editor.lineCount() > line) {
				const at = { line, ch: 0 };
				view.editor.setCursor(at);
				view.editor.scrollIntoView({ from: at, to: at }, true);
				view.editor.focus();
				return;
			}
			await new Promise((resolve) => window.setTimeout(resolve, 20));
		}
	}

	private async openFileAsMindmap(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.setViewState({
			type: MINDMAP_VIEW_TYPE,
			state: { file: file.path },
			active: true,
		});
	}

	// --- header button --------------------------------------------------------

	refreshHeaderButtons(): void {
		if (!this.settings.addHeaderButton) {
			this.removeHeaderButtons();
			return;
		}
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			this.injectHeaderButton(leaf);
		}
	}

	/**
	 * Adds a toggle beside the other view actions so the map feels like another
	 * reading mode. Purely cosmetic: the command, ribbon icon and context menu
	 * all still work if Obsidian's header markup ever changes.
	 */
	private injectHeaderButton(leaf: WorkspaceLeaf): void {
		const actions = leaf.view.containerEl.querySelector(".view-actions");
		if (!actions) return;
		if (actions.querySelector(`.${HEADER_BUTTON_CLASS}`)) return;

		const button = createDiv({
			cls: `clickable-icon view-action ${HEADER_BUTTON_CLASS}`,
			attr: { "aria-label": t("view.action.openMap") },
		});
		setIcon(button, "git-fork");
		button.addEventListener("click", (ev) => {
			ev.preventDefault();
			void this.toggleLeaf(leaf);
		});
		actions.prepend(button);
	}

	private removeHeaderButtons(): void {
		for (const el of Array.from(document.querySelectorAll(`.${HEADER_BUTTON_CLASS}`))) {
			el.remove();
		}
	}
}
