import { MarkdownView, Notice, Plugin, TFile, TFolder, debounce, setIcon } from "obsidian";
import type { OpenViewState, View, ViewState, WorkspaceLeaf } from "obsidian";

import { MINDMAP_VIEW_TYPE, MindmapView } from "./view/MindmapView.ts";
import { lineOfState } from "./view/dropNote.ts";
import { paneActions, placeHeaderSlot } from "./view/headerSlot.ts";
import { SettingsModal } from "./view/settingsModal.ts";
import { EXPORT_COMMANDS } from "./export/run.ts";
import { resolveLanguage, setLanguage, t } from "./i18n.ts";
import type { I18nKey } from "./i18n.ts";
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
import { parkUndo, recordExternalEdit, stepBack, stepForward, takeUndo } from "./undoPark.ts";
import type { ParkedUndo, UndoStacks } from "./undoPark.ts";

/**
 * How many notes keep a parked undo history at once.
 *
 * Each slot holds up to `UNDO_LIMIT` copies of a document, so this is a real
 * budget: enough notes that ordinary jumping around never loses a history, few
 * enough that a vault touched all day does not keep every note it ever opened.
 */
const PARKED_NOTES = 20;

const HEADER_BUTTON_CLASS = "mindflow-toggle";

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
 * Whether this vault has been told what the drag mode changes.
 *
 * One-time user state rather than a setting, so it sits beside the version
 * rather than in `settings` -- nowhere in the interface reads it, and a setting
 * nobody can see is a setting somebody will eventually write a row for.
 */
const DRAG_MODE_KEY = "dragModeExplained";

/**
 * How long a fold change waits before it reaches disk.
 *
 * Every toggle, expand-all and selection move asks to be saved, and a user
 * walking a big map does that a few times a second. Long enough to collapse a
 * burst into one write, short enough that a crash loses a click, not an hour.
 */
const FOLD_SAVE_DELAY = 800;

/**
 * A map a leaf was left holding: the note it was showing, and the view showing
 * it. The view is the identity that decides whether that map is still there --
 * see `MindmapPlugin.mapLeaves`.
 */
interface HeldMap {
	path: string;
	view: MindmapView;
}

/**
 * The file a leaf is showing, or null.
 *
 * `WorkspaceLeaf.view` is typed as `View`, and only the file-backed views
 * (`MarkdownView`, this plugin's own view, the Canvas view) carry a `file`.
 * Asking with a narrowing predicate rather than an inline assertion keeps the
 * three call sites honest: a cast would let a typo in the field name through,
 * and this is the one place that decides.
 */
function leafFile(leaf: WorkspaceLeaf): TFile | null {
	const view: unknown = leaf.view;
	if (typeof view !== "object" || view === null) return null;
	const file: unknown = (view as { file?: unknown }).file;
	return file instanceof TFile ? file : null;
}

/**
 * The line a view-switching call is asking for, or null.
 *
 * Obsidian carries it as *ephemeral state*: `openFile` and `setViewState` both
 * take one, and the outline pane -- the caller all of this exists for -- puts
 * the line it wants there. Both channels are read, because which one a given
 * caller uses is not something this can know from here.
 */
function lineOfSwitch(open: { eState?: unknown; state?: unknown } | undefined): number | null {
	if (!open) return null;
	return lineOfState(open.eState) ?? lineOfState(open.state);
}

/** A leaf method that swaps the view, in the shape the patch has to keep. */
type LeafSwitch = (this: WorkspaceLeaf, ...args: unknown[]) => Promise<void>;

/** The two methods the patch replaces, and the plugin answering for it. */
interface SwitchPatch {
	plugin: MindmapPlugin;
	openFile: LeafSwitch;
	setViewState: LeafSwitch;
}

/**
 * Where the replaced methods live, on the prototype itself.
 *
 * On the prototype rather than in the instance, because a plugin reload builds
 * a new plugin over a prototype that is still patched: finding this is what
 * tells the new instance to take the patch over rather than wrap a wrapper.
 */
const SWITCH_PATCH = Symbol("mindflow-leaf-switch-patch");

export default class MindmapPlugin extends Plugin {
	override settings: MindmapSettings = { ...DEFAULT_SETTINGS };

	/** Fold and focus state per note path. Shares `data.json` with the settings. */
	private foldStore: FoldStore = {};

	/** The version of the plugin this vault last loaded, or null if none is kept. */
	private lastSeenVersion: string | null = null;

	/** Whether the drag mode has ever been explained here -- see `dragMode.ts`. */
	private dragModeExplained = false;

	/** Whether `data.json` held no settings, which is a first install. */
	private freshInstall = false;

	/**
	 * The undo history of every note that has one: for the next view that shows
	 * the note, and for the markdown editor reaching the same stacks from its
	 * own side.
	 *
	 * One slot per note rather than a single slot, because a single slot keeps
	 * only the last -- a detour through another note that also had a map open
	 * would throw the first note's history away.
	 */
	private parkedUndo = new Map<string, ParkedUndo>();

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
	 * The map each leaf is holding, by the view instance that is holding it.
	 *
	 * Kept so that a leaf which swaps *away* from a map can be told apart from
	 * one that was never a map: the outline pane's press, and any
	 * `[[note#heading]]` click, arrives as a markdown view, and the only thing
	 * that says whether the reader was looking at a map when they asked is what
	 * that leaf was showing a moment before.
	 *
	 * The *view* is what is remembered, not the view type. Obsidian's own
	 * request to show a line re-resolves the view type for the file on its way
	 * past, so by the time anything observable has happened the map is already
	 * gone; an identity check does not care when it went, only that the thing
	 * in the leaf is no longer the thing this plugin put there. Deleted by the
	 * swap back, by the recovery, and when the tab is closed.
	 */
	private mapLeaves = new Map<WorkspaceLeaf, HeldMap>();

	/**
	 * True while this plugin is the one swapping a leaf's view.
	 *
	 * A swap raises `layout-change` in the middle of itself, and the entry
	 * above still describes the view being replaced -- so without this the
	 * plugin would read its own swap as somebody having stolen the map and
	 * swap it back, forever. One flag rather than a re-entrancy test, because
	 * "we are the ones doing this" is exactly the thing being asserted.
	 */
	private swapping = false;

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
		// One line, once, on the way in. With a map open it is not obvious which
		// build is running -- "the new thing does nothing" and "an old build is
		// running" look exactly alike from the outside, and this is the difference
		// made visible without a file timestamp or a guess. `debug` rather than
		// `log`: the plugin review allows warn, error and debug, and this is
		// neither of the first two -- turn Verbose on in the console to see it.
		console.debug(`mindflow ${this.manifest.version} loaded`);

		// Before anything can open a note: a press in the outline pane asks the
		// workspace for a line, and this is what answers it in place of the view
		// swap that would otherwise be visible. See `installLeafSwitchPatch`.
		this.installLeafSwitchPatch();

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

		// The same bar with its replace row showing. No default hotkey for the
		// same reason as the search above: Mod+H belongs to whatever else is
		// listening until this map has the keyboard, and the map's own key is
		// registered in `view/shortcuts.ts` rather than globally.
		this.addCommand({
			id: "replace-mindmap",
			name: t("command.replace"),
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MindmapView);
				if (!view) return false;
				if (!checking) view.openReplace();
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

		// The three that turn a card into a door. Gated the same way the move
		// commands are, and each offered only where it means something: a node
		// that is already a link is not offered "link to a note" a second time,
		// and a node with no usable words is not offered a note named after it.
		const linkCommands: ReadonlyArray<{
			id: string;
			nameKey: I18nKey;
			applies: (view: MindmapView, id: string) => boolean;
			run: (view: MindmapView, id: string) => void;
		}> = [
			{
				id: "link-node-to-note",
				nameKey: "command.linkToNote",
				applies: (view, id) => view.canLink(id),
				run: (view, id) => view.linkNodeToNote(id),
			},
			{
				id: "create-note-from-node",
				nameKey: "command.createNote",
				applies: (view, id) => view.canCreateNote(id),
				run: (view, id) => view.createNoteFromNode(id),
			},
			{
				id: "unlink-node",
				nameKey: "command.unlink",
				applies: (view, id) => view.canUnlink(id),
				run: (view, id) => view.unlinkNode(id),
			},
		];
		for (const entry of linkCommands) {
			this.addCommand({
				id: entry.id,
				name: t(entry.nameKey),
				checkCallback: (checking) => {
					const view = this.app.workspace.getActiveViewOfType(MindmapView);
					const id = view?.selectedId() ?? null;
					if (!view || id === null || !entry.applies(view, id)) return false;
					if (!checking) entry.run(view, id);
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

		// The dialog the map opens from its toolbar, reachable without the map --
		// which matters more than it sounds: the toolbar hides itself until a card
		// is picked, so this is the only way in from a palette, and the only way
		// to answer "is the build I just installed the one running".
		this.addCommand({
			id: "open-settings",
			name: t("command.settings"),
			// Opened from a palette the map may well be the view behind it, and
			// the focus the window takes has to come back to the map's own keys
			// rather than to nothing. `focusMap` refuses when this is not the
			// active view, so the answer is safe to offer from anywhere.
			callback: () =>
				new SettingsModal(this.app, this, () => {
					this.app.workspace.getActiveViewOfType(MindmapView)?.focusMap();
				}).open(),
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

		// In the markdown editor, Ctrl+Enter inserts a new line starting with
		// ": " — the annotation prefix the map reads as a note under the node
		// above. Registered as a plugin command (for the palette and for
		// rebinding), and given a default Ctrl+Enter hotkey through a DOM-level
		// listener on the editor element. Disabling the plugin removes both.
		this.addCommand({
			id: "insert-annotation-line",
			name: t("command.insertAnnotation"),
			editorCallback: (editor) => {
				const cursor = editor.getCursor();
				const line = editor.getLine(cursor.line);
				const marker = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)/.exec(line);
				const prefix = marker ? `${marker[1]}${marker[2]}${marker[3] || " "}: ` : ": ";
				editor.replaceRange(`\n${prefix}`, { line: cursor.line, ch: line.length });
				const newLine = cursor.line + 1;
				editor.setCursor({ line: newLine, ch: prefix.length });
				editor.focus();
			},
		});

		// Default Ctrl+Enter in the markdown editor, live while the plugin is
		// on and gone when it is off. Registered on the document with capture so
		// it fires before the editor's own keymap, and only acts when a
		// MarkdownView is the active leaf.
		this.registerDomEvent(document, "keydown", (ev: KeyboardEvent) => {
			if (ev.key !== "Enter" || !(ev.ctrlKey || ev.metaKey) || ev.shiftKey || ev.altKey) return;
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) return;
			// Only in source mode; reading mode has no editor to insert into.
			const editor = view.editor;
			if (!editor) return;
			ev.preventDefault();
			ev.stopPropagation();
			const cursor = editor.getCursor();
			const line = editor.getLine(cursor.line);
			const marker = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)/.exec(line);
			const prefix = marker ? `${marker[1]}${marker[2]}${marker[3] || " "}: ` : ": ";
			editor.replaceRange(`\n${prefix}`, { line: cursor.line, ch: line.length });
			const newLine = cursor.line + 1;
			editor.setCursor({ line: newLine, ch: prefix.length });
			editor.focus();
		}, true);

		// Ctrl/Cmd+Z in the markdown editor, reaching the history the map and
		// the editor share.
		//
		// They are two views of one note and share one stack -- the map has
		// always been able to undo what the editor did. This is the other
		// direction, and it is the harder one, because the key belongs to the
		// editor: CodeMirror's own undo comes first and unchanged. Stepping back
		// word by word is what a person expects from Ctrl+Z in a text field, and
		// taking that away to reach a map edit would be a worse deal than the
		// gap it closes. Only once the editor has nothing of its own left does
		// the key belong to the shared history.
		//
		// "Nothing left" is asked by taking a step and seeing whether the
		// document moved, rather than by reading CodeMirror's own depth: that
		// lives in `@codemirror/commands`, which is not part of the API this
		// plugin is given, and a runtime that cannot resolve it would take the
		// plugin down with it.
		//
		// A note with no parked history is left entirely alone -- which is every
		// note never opened as a map, so the common case pays nothing for this.
		this.registerDomEvent(document, "keydown", (ev: KeyboardEvent) => {
			if (ev.key.toLowerCase() !== "z" || !(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			const editor = view?.editor;
			const file = view?.file;
			if (!view || !editor || !file) return;
			if (!this.parkedUndo.has(file.path)) return;

			const forward = ev.shiftKey;
			const before = editor.getValue();
			if (forward) editor.redo();
			else editor.undo();
			if (editor.getValue() !== before) {
				// The editor had a step of its own and has just taken it. The key
				// is stopped here too: letting it reach the editor's own keymap
				// would take a second step on top of this one.
				ev.preventDefault();
				ev.stopPropagation();
				return;
			}

			// Nothing left in the editor's own history, so whatever comes next
			// is the map's -- and the key is taken from a keymap that would do
			// nothing with it in any case.
			ev.preventDefault();
			ev.stopPropagation();
			void this.stepNoteHistory(file, forward);
		}, true);

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file, _source, leaf) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				// A note that *is* a map is left to the map. Obsidian opens this
				// event and the view's own pane menu for one right-click on a
				// tab, and the map answers the second of them with this same
				// entry -- so answering here as well put two identical "edit as
				// markdown" items in one menu. What is left for this handler is
				// the file explorer's press, where there is no view of ours to
				// ask: see `openFileAsMindmap` for what that does.
				if (leaf?.view.getViewType() === MINDMAP_VIEW_TYPE) return;
				menu.addItem((item) =>
					item
						.setTitle(t("view.action.openMap"))
						.setIcon("git-fork")
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
				if (!(file instanceof TFile) || file.extension !== "md") return;
				void this.trackExternalEdit(file);
				// A map may be showing this note under a card that links to it.
				// The read itself needs no telling -- it is stamped with the
				// mtime, so a new one is a miss -- but the outline built from
				// the old text is a set of nodes with ids of its own, and it
				// would go on saying what the note said before the edit.
				this.forgetLinkReads(file.path);
			}),
		);

		// A note the user last left as a map opens as one again. Only when the
		// leaf is showing it as markdown, which is what a fresh open looks like
		// -- and what stops this from firing on the swap it has just made.
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!file) return;
				// Before anything else, and whether or not this file is one of
				// the remembered ones: a map that was taken away is put back
				// whatever the note's own state says.
				this.restoreStolenMaps();

				const leaf = this.app.workspace.getMostRecentLeaf();
				if (!leaf || leaf.view.getViewType() !== "markdown") return;
				if (leafFile(leaf)?.path !== file.path) return;
				if (!this.markedAsMap(file.path)) return;
				void this.setMindmapView(leaf);
			}),
		);

		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				// A view swap lands here, which is what makes this the net that
				// catches a map being taken away -- see `restoreStolenMaps`.
				this.restoreStolenMaps();
				this.refreshHeaderButtons();
			}),
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				this.refreshHeaderButtons();
				// Coming back to a map has to put the keyboard back inside it. Its
				// own keys are listeners on the viewport -- the pan key, and the
				// shortcut table besides the actions the scope carries -- and the
				// focus a leaf is given sits one element above that. `focusMap`
				// asks the questions: only when this map is the one in front, and
				// never over an edit. See it for the rest.
				if (leaf?.view instanceof MindmapView) leaf.view.focusMap();
			}),
		);
		this.app.workspace.onLayoutReady(() => {
			// The patch is installed on the shared prototype, which is found by
			// borrowing a leaf -- and a plugin can load before the workspace has
			// opened one. Asked again here, where the layout has restored the
			// tabs; the second call is a no-op when the first one landed.
			this.installLeafSwitchPatch();
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
		this.removeLeafSwitchPatch();
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
		const {
			[FOLD_STATE_KEY]: folds,
			[VERSION_KEY]: seen,
			[MAP_NOTES_KEY]: maps,
			[DRAG_MODE_KEY]: dragMode,
			...rest
		} = stored ?? {};
		this.foldStore = readStore(folds);
		this.lastSeenVersion = typeof seen === "string" ? seen : null;
		this.dragModeExplained = dragMode === true;
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
	/**
	 * Whether the drag mode has already been explained in this vault.
	 *
	 * Read by the settings panel when the toggle goes on: the explanation is for
	 * the person meeting the new gesture, and there is only ever one of those.
	 */
	get dragModeWasExplained(): boolean {
		return this.dragModeExplained;
	}

	/** Remember that it has been, so no later switch explains it again. */
	markDragModeExplained(): void {
		if (this.dragModeExplained) return;
		this.dragModeExplained = true;
		this.queueSave();
	}

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
			// Written only once it is true: a `false` here would be a line in the
			// file saying nothing happened.
			...(this.dragModeExplained ? { [DRAG_MODE_KEY]: true } : {}),
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
		// Deleted before it is set so the note counts as the most recent user of
		// the map: a `Map` keeps insertion order, so the first key is the
		// coldest, and that is the one to drop once the budget is spent.
		this.parkedUndo.delete(path);
		this.parkedUndo.set(path, parkUndo(path, data, undo, redo));
		while (this.parkedUndo.size > PARKED_NOTES) {
			const coldest = this.parkedUndo.keys().next().value;
			if (coldest === undefined) break;
			this.parkedUndo.delete(coldest);
		}
	}

	/**
	 * The history recorded for exactly this document, or null.
	 *
	 * `takeUndo` holds the rule and its reasoning; this only keeps the slot.
	 */
	adoptUndo(path: string, data: string): UndoStacks | null {
		const take = takeUndo(this.parkedUndo.get(path) ?? null, path, data);
		if (take.slot) this.parkedUndo.set(path, take.slot);
		else this.parkedUndo.delete(path);
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
		if (!this.parkedUndo.has(file.path) || this.readingFor !== null) return;
		this.readingFor = file.path;
		try {
			const data = await this.app.vault.read(file);
			// The slot can be spent while the read is out, and the note it is
			// holding is then not this one.
			const current = this.parkedUndo.get(file.path);
			if (!current) return;
			this.parkedUndo.set(file.path, recordExternalEdit(current, data));
		} finally {
			this.readingFor = null;
		}
	}

	/**
	 * Step the note's own history back or forward, from the markdown editor.
	 *
	 * The map walks these stacks itself. A markdown view has no stack to walk:
	 * the editor's undo belongs to CodeMirror, and Obsidian rebuilds the editor
	 * on every swap, so that history is gone the moment a note comes back from
	 * the map. What is left is the parked one, and the key has to reach it.
	 *
	 * Written through the vault rather than through `Editor.setValue`: a write
	 * through the editor is a step in CodeMirror's own history, and the *next*
	 * Ctrl+Z would undo this undo instead of going further back. Writing the
	 * file leaves the editor in the state a view swap leaves it in -- reloaded,
	 * with nothing of its own to give back -- which is what the next press of
	 * the key expects. False when the history had nothing to give.
	 */
	private async stepNoteHistory(file: TFile, forward: boolean): Promise<boolean> {
		const slot = this.parkedUndo.get(file.path);
		if (!slot) return false;
		const current = await this.app.vault.read(file);
		const step = forward ? stepForward(slot, current) : stepBack(slot, current);
		if (!step) return false;
		// Filed before the write, and not after: the write comes back as an
		// external edit, and the slot has to already hold the document being
		// written, or that edit files a step for a change the history made.
		this.parkedUndo.set(file.path, step.slot);
		await this.app.vault.modify(file, step.data);
		return true;
	}

	refreshAllViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof MindmapView) view.refresh();
		}
	}

	/**
	 * A note changed under the maps that are reading it.
	 *
	 * Told, rather than asked for: a map knows which cards point where, and the
	 * vault does not. Only the maps that were actually projecting this note do
	 * anything about it, so a vault-wide edit -- a sync client landing a hundred
	 * files -- costs a lookup per open map per file and nothing else.
	 */
	forgetLinkReads(path: string): void {
		for (const leaf of this.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof MindmapView) view.forgetLinkRead(path);
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
		const file = leafFile(leaf);
		if (!file || file.extension !== "md") {
			new Notice(t("main.notice.onlyMarkdown"));
			return;
		}

		this.previousState.set(leaf, state);
		this.rememberView(file.path, true);
		this.swapping = true;
		try {
			await leaf.setViewState(
				{
					type: MINDMAP_VIEW_TYPE,
					state: { file: file.path },
					active: true,
				},
				{ focus: true },
			);
		} finally {
			this.swapping = false;
		}
		const view = leaf.view as View | undefined;
		if (view instanceof MindmapView) this.mapLeaves.set(leaf, { path: file.path, view });
	}

	/**
	 * Swap back to the editor.
	 *
	 * `remember` is false for a switch the plugin made on the user's behalf.
	 * Ctrl/Cmd+clicking a card to see the line it is written on is a look at the
	 * note, not a decision to stop opening that note as a map.
	 */
	async setMarkdownView(leaf: WorkspaceLeaf, remember = true): Promise<void> {
		const file = leafFile(leaf);
		this.mapLeaves.delete(leaf);
		if (remember && file) this.rememberView(file.path, false);
		const remembered = this.previousState.get(leaf);

		const next: ViewState = remembered
			? { ...remembered, active: true }
			: { type: "markdown", state: file ? { file: file.path } : {}, active: true };

		// The remembered state may point at a different note if the user navigated.
		if (remembered && file) {
			next.state = { ...(remembered.state ?? {}), file: file.path };
		}

		this.swapping = true;
		try {
			await leaf.setViewState(next, { focus: true });
		} finally {
			this.swapping = false;
		}
	}

	/**
	 * The line a map loading this note is to select, or null.
	 *
	 * Taken once. A map that loads some other note leaves it standing rather
	 * than eating it -- the user asked for a card on the note they were reading,
	 * not on whichever note happened to open next.
	 */
	/**
	 * Put a map back that something other than the plugin has taken away.
	 *
	 * The outline pane is the caller this exists for. Pressing a heading there
	 * asks the workspace to show a *line*, and the workspace resolves the file's
	 * view type on the way -- `.md` means the editor -- so the map the reader was
	 * looking at is replaced before anything can be said about it. Nothing in
	 * that request means "leave the map", and to a reader of a map it plainly
	 * means "show me that card", so the map goes back with the line's card
	 * selected and in the middle of the view.
	 *
	 * Detection is by identity rather than by asking whether the leaf shows
	 * markdown now: whatever did the swap, the leaf is no longer holding the view
	 * this plugin put in it, and that becomes true the instant it stops being
	 * true -- no dependence on which event arrives first. Entries are spent as
	 * they are used, so a note the reader has since chosen to see as markdown is
	 * theirs to keep that way: the plugin never takes the same map back twice.
	 */
	private restoreStolenMaps(): void {
		if (this.swapping || this.mapLeaves.size === 0) return;
		const live = new Set<WorkspaceLeaf>();
		this.app.workspace.iterateAllLeaves((leaf) => {
			live.add(leaf);
			const held = this.mapLeaves.get(leaf);
			if (!held || leaf.view === held.view) return;
			this.mapLeaves.delete(leaf);
			const view = leaf.view as View | undefined;
			// Only the editor can have taken it. A tab that is closing, or one
			// that has moved on to another note, is not a map to put back.
			if (!view || view.getViewType() !== "markdown") return;
			if (leafFile(leaf)?.path !== held.path) return;
			void this.restoreMap(leaf, held.path);
		});
		// A leaf the workspace no longer lists is a map tab that was closed, and
		// there is nothing left for its entry to describe.
		for (const leaf of [...this.mapLeaves.keys()]) {
			if (!live.has(leaf)) this.mapLeaves.delete(leaf);
		}
	}

	/** The map for `path` back into `leaf`, sitting on the line the editor is at. */
	private async restoreMap(leaf: WorkspaceLeaf, path: string): Promise<void> {
		const line = await this.lineTheEditorLandedOn(leaf);
		this.pendingReveal = { path, line };
		await this.setMindmapView(leaf);
	}

	/**
	 * The line the editor that has just replaced a map is sitting at.
	 *
	 * `file-open` carries no line, so it is read off the view that was asked:
	 * the ephemeral state is what the caller said, and the caret is where the
	 * view ended up. Which of the two the caller moved is not something this can
	 * know, so both are read, and the explicit one is asked first. Landing on the
	 * wrong card still lands on the map, which is the difference that matters
	 * here.
	 *
	 * The wait is for the answer rather than for the view: a line can arrive a
	 * frame after the swap, and a read taken too early would put the selection
	 * back at the top of the note. Bounded, because a view that never moves is
	 * not something to hang on.
	 */
	private async lineTheEditorLandedOn(leaf: WorkspaceLeaf): Promise<number> {
		for (let attempt = 0; attempt < 10; attempt++) {
			const view = leaf.view as View | undefined;
			if (!view || view.getViewType() !== "markdown") break;
			const asked = lineOfState(view.getEphemeralState());
			if (asked !== null) return asked;
			const markdown = view as MarkdownView;
			const cursor = markdown.editor?.getCursor?.();
			if (typeof cursor?.line === "number" && cursor.line > 0) return cursor.line;
			await new Promise((resolve) => window.setTimeout(resolve, 20));
		}
		return 0;
	}

	// --- keeping a map that was asked for a line -----------------------------

	/**
	 * Answer for the line instead of letting the workspace swap the view.
	 *
	 * This is what removes the flicker. Obsidian resolves a view type for the
	 * file on the way to showing a line -- `.md` means the editor -- so a press
	 * in the outline pane used to replace the map, and putting the map back
	 * afterwards was a switch the reader could see. The request is caught here,
	 * before that resolution happens, and answered by the map that is already
	 * open: the card is selected and centred, the view is never replaced, and
	 * there is nothing left to flicker.
	 *
	 * Answering for the line is all it does. A different file, a leaf showing
	 * anything but this plugin's map, and a request that carries no line all
	 * pass through untouched -- which is what keeps "open this note here"
	 * meaning what it has always meant everywhere else, including the toggle
	 * back to the editor.
	 */
	private keepMapOnLine(leaf: WorkspaceLeaf, path: string, line: number | null): boolean {
		if (line === null) return false;
		const held = this.mapLeaves.get(leaf);
		if (!held || held.path !== path) return false;
		const view: View | undefined = leaf.view;
		if (!(view instanceof MindmapView) || view !== held.view) return false;
		view.focusLine(line);
		return true;
	}

	/** The same question for `openFile`, where the file is its own argument. */
	private keepMapForOpen(
		leaf: WorkspaceLeaf,
		file: unknown,
		open: OpenViewState | undefined,
	): boolean {
		if (!(file instanceof TFile)) return false;
		return this.keepMapOnLine(leaf, file.path, lineOfSwitch(open));
	}

	/** And for `setViewState`, where the file sits inside the state. */
	private keepMapForState(
		leaf: WorkspaceLeaf,
		state: ViewState | undefined,
		eState: unknown,
	): boolean {
		if (!state || state.type === MINDMAP_VIEW_TYPE) return false;
		const named = (state.state ?? {}) as { file?: unknown };
		// A path, which is what a view state carries, and a `TFile` as well:
		// the shape of somebody else's state is not this plugin's to insist on.
		const path =
			typeof named.file === "string"
				? named.file
				: named.file instanceof TFile
					? named.file.path
					: null;
		if (path === null) return false;
		return this.keepMapOnLine(leaf, path, lineOfSwitch({ eState, state: state.state }));
	}

	/**
	 * The prototype every leaf shares, taken off a leaf that is already open.
	 *
	 * Taken this way rather than from `WorkspaceLeaf.prototype` so the patch
	 * does not depend on Obsidian exporting that class as a value: the type is
	 * all the plugin is promised. Nothing is opened to find one -- the walk is
	 * over the leaves the workspace already has.
	 */
	private leafPrototype(): Record<PropertyKey, unknown> | null {
		let sample: WorkspaceLeaf | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			sample ??= leaf;
		});
		if (!sample) return null;
		const proto = Object.getPrototypeOf(sample) as Record<PropertyKey, unknown> | null;
		if (!proto || typeof proto.openFile !== "function") return null;
		return proto;
	}

	/**
	 * Catch a "show line N" before Obsidian resolves a view for it.
	 *
	 * Two entry points are wrapped because both are ways in: `openFile` is what
	 * the outline pane and a `[[note#heading]]` press reach for, and
	 * `setViewState` is what a caller that wants a particular view uses. Both
	 * end in the same place -- a view type resolved for the file -- so both have
	 * to be answered in the same place to be sure the flicker is gone.
	 *
	 * The replaced methods are kept on the prototype, which is what makes a
	 * reload safe: the instance that installs this may not be the one that
	 * removes it, and a wrapper that wrapped the wrapper would grow a chain of
	 * dead plugins.
	 */
	private installLeafSwitchPatch(): void {
		const proto = this.leafPrototype();
		if (!proto) return;
		const existing = proto[SWITCH_PATCH] as SwitchPatch | undefined;
		if (existing) {
			// A reload: the prototype is still patched by the instance before
			// this one, and the new instance takes the patch over.
			existing.plugin = this;
			return;
		}

		const patch: SwitchPatch = {
			plugin: this,
			openFile: proto.openFile as LeafSwitch,
			setViewState: proto.setViewState as LeafSwitch,
		};
		const owner = (): MindmapPlugin | undefined => {
			const current = proto[SWITCH_PATCH] as SwitchPatch | undefined;
			return current?.plugin;
		};

		proto.openFile = function (this: WorkspaceLeaf, ...args: unknown[]): Promise<void> {
			const asked = owner();
			const open = args[1] as OpenViewState | undefined;
			if (asked?.keepMapForOpen(this, args[0], open)) return Promise.resolve();
			return patch.openFile.apply(this, args);
		};
		proto.setViewState = function (this: WorkspaceLeaf, ...args: unknown[]): Promise<void> {
			const asked = owner();
			const state = args[0] as ViewState | undefined;
			if (asked?.keepMapForState(this, state, args[1])) return Promise.resolve();
			return patch.setViewState.apply(this, args);
		};
		proto[SWITCH_PATCH] = patch;
	}

	/** Put the leaf's own methods back, unless a newer instance owns the patch. */
	private removeLeafSwitchPatch(): void {
		const proto = this.leafPrototype();
		const patch = proto?.[SWITCH_PATCH] as SwitchPatch | undefined;
		if (!proto || !patch || patch.plugin !== this) return;
		proto.openFile = patch.openFile;
		proto.setViewState = patch.setViewState;
		delete proto[SWITCH_PATCH];
	}

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
		const actions = paneActions(leaf.view.containerEl);
		if (!actions) return;
		const existing = actions.querySelector(`.${HEADER_BUTTON_CLASS}`);
		if (existing instanceof HTMLElement) {
			// Already there, but not necessarily still in the right place: the
			// row is rebuilt as the view changes mode, and a row rebuilt around
			// our button can leave it wherever it happened to fall. Cheap to
			// line up again, and this runs on every layout change anyway.
			placeHeaderSlot(actions, existing);
			return;
		}

		const button = createDiv({
			cls: `clickable-icon view-action ${HEADER_BUTTON_CLASS}`,
			attr: { "aria-label": t("view.action.openMap") },
		});
		setIcon(button, "git-fork");
		button.addEventListener("click", (ev) => {
			ev.preventDefault();
			void this.toggleLeaf(leaf);
		});
		// The slot, not the front of the row: the map's own button is put in the
		// same place, so going back and forth is one press in one spot rather
		// than a hunt for where the icon went. See `placeHeaderSlot`.
		placeHeaderSlot(actions, button);
	}

	private removeHeaderButtons(): void {
		for (const el of Array.from(document.querySelectorAll(`.${HEADER_BUTTON_CLASS}`))) {
			el.remove();
		}
	}
}
