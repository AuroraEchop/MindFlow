import { Modal } from "obsidian";
import type { App } from "obsidian";

import { t } from "../i18n.ts";
import { SettingsPanel } from "../settings.ts";
import type MindmapPlugin from "../main.ts";

/**
 * The settings, as a window over the map.
 *
 * A page per group with the groups down the side, rather than one long scroll:
 * the settings are past a screenful now, and the map is somewhere a person is
 * working -- a window they can open, change one thing in, and close beats a
 * trip through Obsidian's own settings and back.
 *
 * The rows are the same rows the settings tab draws, from the same panel. This
 * is a second door into them, not a second copy of them.
 */
export class SettingsModal extends Modal {
	private readonly panel: SettingsPanel;

	/** Both are built in `onOpen`, and neither exists before it runs. */
	private navEl!: HTMLElement;
	private paneEl!: HTMLElement;

	private page = 0;

	constructor(app: App, plugin: MindmapPlugin) {
		super(app);
		this.panel = new SettingsPanel(plugin);
		// A change of language has to redraw the page on screen, and this is the
		// only thing that knows which page that is.
		this.panel.repaint = () => this.show(this.page);
	}

	override onOpen(): void {
		this.modalEl.addClass("mm-settings-dialog");
		this.setTitle(t("dialog.settings.title"));

		// Make the modal draggable by its title bar. Obsidian's Modal does
		// not do this by default — it centres on open. We add a pointer
		// drag on the title bar so the user can park the window wherever
		// they like while the map stays visible behind it.
		const titleEl = this.titleEl;
		if (titleEl) {
			titleEl.addClass("mm-settings-handle");
			let dragOrigin: { x: number; y: number; left: number; top: number } | null = null;
			titleEl.addEventListener("pointerdown", (ev) => {
				if (ev.button !== 0) return;
				const rect = this.modalEl.getBoundingClientRect();
				// Switch from centred to pinned before dragging, so `left/top`
				// take effect. Measured first, because it is the class that
				// moves it; only `left`/`top` are left to the pointer.
				this.modalEl.addClass("is-dragging");
				this.modalEl.style.left = `${rect.left}px`;
				this.modalEl.style.top = `${rect.top}px`;
				// Capture the pointer to the title bar. A fast drag leaves the bar
				// long before the button goes up, and without the capture every
				// move outside the element is delivered to whatever now sits under
				// the pointer instead -- the drag dies the moment the hand outruns
				// the window. With it, every move comes here until the button goes
				// up, however far outside the window that happens.
				titleEl.setPointerCapture(ev.pointerId);
				dragOrigin = { x: ev.clientX, y: ev.clientY, left: rect.left, top: rect.top };
				ev.preventDefault();
			});
			titleEl.addEventListener("pointermove", (ev) => {
				if (!dragOrigin) return;
				this.modalEl.style.left = `${dragOrigin.left + (ev.clientX - dragOrigin.x)}px`;
				this.modalEl.style.top = `${dragOrigin.top + (ev.clientY - dragOrigin.y)}px`;
			});
			const stop = (): void => { dragOrigin = null; };
			titleEl.addEventListener("pointerup", stop);
			titleEl.addEventListener("pointercancel", stop);
		}

		const body = this.contentEl.createDiv({ cls: "mm-settings" });
		this.navEl = body.createDiv({ cls: "mm-settings-nav" });
		this.paneEl = body.createDiv({ cls: "mm-settings-pane" });
		this.show(this.page);
	}

	override onClose(): void {
		// A shortcut row still listening for a key would go on capturing one
		// after the window it belongs to has gone.
		this.panel.endRecording();
		this.contentEl.empty();
	}

	/** Draw one page, and mark it in the navigation. */
	private show(index: number): void {
		this.page = index;
		this.navEl.empty();

		this.panel.pages.forEach((heading, at) => {
			const item = this.navEl.createDiv({
				cls: "mm-settings-tab",
				text: t(heading),
				attr: { role: "button", tabindex: "0" },
			});
			item.toggleClass("is-active", at === index);
			item.addEventListener("click", () => this.show(at));
			item.addEventListener("keydown", (ev) => {
				if (ev.key !== "Enter" && ev.key !== " ") return;
				ev.preventDefault();
				this.show(at);
			});
		});

		this.paneEl.empty();
		this.panel.renderPage(this.paneEl, index);
	}
}
