/**
 * A short message, drawn inside the view rather than in Obsidian's corner.
 *
 * Obsidian puts its own notices at the top right of the *window* -- which is
 * where the tab strip and the window controls live, so a message that arrives in
 * a burst sits on top of them. A map's messages are about the map, so they are
 * drawn on the map: a stack in the view's own top right corner, below the pane
 * header, where the only thing they can cover is the map they are about.
 *
 * The look is Obsidian's own `.notice`, so a theme that restyles its notices
 * restyles these the same way. What the stack adds is the place, a cap on how
 * many may be up at once, and a single timer for the whole set -- which is the
 * part that matters: notices that arrive milliseconds apart, each on a lifetime
 * of its own, would go out and be replaced one after another, and a held key
 * would keep that going for as long as it was held. So a run of them is one
 * block that comes down together, a beat after the last one arrived.
 */

/** How many one run of messages may leave on screen. */
const MAX_TOASTS = 3;

/** How long the run stays up, measured from its last message. */
const TOAST_MS = 2500;

export class ToastStack {
	private host: HTMLElement | null = null;
	private items: HTMLElement[] = [];
	private timer: number | null = null;
	private readonly parent: HTMLElement;

	constructor(parent: HTMLElement) {
		this.parent = parent;
	}

	/**
	 * Put a message up, and hold the run's notices a beat longer.
	 *
	 * Past the cap a message is dropped rather than replacing an older one:
	 * these arrive from a held key, and a stack that kept making room for every
	 * repeat would churn for as long as the key was down, which is the same
	 * flicker the shared timer exists to prevent.
	 */
	show(text: string): void {
		if (this.items.length < MAX_TOASTS) {
			this.host ??= this.parent.createDiv({ cls: "mm-toasts" });
			const el = this.host.createDiv({ cls: "notice mm-toast" });
			el.setText(text);
			this.items.push(el);
		}
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => this.clear(), TOAST_MS);
	}

	/**
	 * Take them down now, and end the run that was holding them up.
	 *
	 * The view calls this when the note or the tab goes away, since nothing else
	 * would: the messages are asked for no lifetime of their own, so a stack left
	 * behind by a closing view would keep them up for good.
	 */
	clear(): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
		for (const el of this.items) el.remove();
		this.items = [];
		this.host?.remove();
		this.host = null;
	}
}
