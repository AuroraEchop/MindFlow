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
