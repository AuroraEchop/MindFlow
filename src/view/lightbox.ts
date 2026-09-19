import { setIcon, TFile } from "obsidian";
import type { App } from "obsidian";

import { t } from "../i18n.ts";
import { mediaKindOf } from "../model/media.ts";

/**
 * The enlarged preview.
 *
 * A picture on a card is capped -- by the card's own width, and by the media
 * height setting -- because a map is a place to see the shape of a note, not a
 * place to read one photograph. That cap is the whole reason this exists: a
 * click asks for the file at a size the card was never going to give it.
 *
 * Deliberately not a leaf. Handing the file to Obsidian is what the `⧉` button
 * is for, and doing it on a plain click means leaving the map to look at one
 * picture and finding your place again afterwards. This covers the map instead
 * and gives it back exactly as it was.
 *
 * Two things about where it lives. It is appended to the view's own element
 * rather than to `.mm-content`, so it neither pans nor zooms with the camera --
 * a preview that slid around when you scrolled would be a preview of the map,
 * not of the picture. And for the same reason it never reaches an export:
 * `snapshotMap` clones `.mm-content`, and a preview is a moment in the app
 * rather than part of the map.
 */
export class Lightbox {
	private readonly app: App;
	private readonly container: HTMLElement;

	private root: HTMLElement | null = null;
	private cleanup: (() => void) | null = null;
	private focusBack: HTMLElement | null = null;

	constructor(app: App, container: HTMLElement) {
		this.app = app;
		this.container = container;
	}

	get isOpen(): boolean {
		return this.root !== null;
	}

	/** Show `path` over the map. A second call replaces whatever was up. */
	open(path: string, label: string, focusBack: HTMLElement | null): void {
		this.close();

		const kind = mediaKindOf(path);
		if (kind === null) return;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		const src = this.app.vault.getResourcePath(file);

		const root = this.container.createDiv({ cls: "mm-lightbox" });
		root.setAttribute("role", "dialog");
		root.setAttribute("aria-modal", "true");
		root.setAttribute("aria-label", label);
		this.root = root;
		this.focusBack = focusBack;

		if (kind === "image") this.buildImage(root, src, label);
		else this.buildVideo(root, src);
		this.buildClose(root);

		// One rule dismisses the whole overlay: a click on the media is the
		// media's, and anything else closes. Written as "not the media" rather
		// than "is the backdrop" on purpose -- the close button shipped with no
		// listener of its own and did nothing at all, and a rule phrased this
		// way would have covered it, and covers whatever chrome comes next.
		root.addEventListener("click", (ev) => {
			const target = ev.target;
			if (target instanceof Element && target.closest(".mm-lightbox-el")) return;
			this.close();
		});

		// Capture, so the preview owns Escape for as long as it is up. A modal
		// covering the whole pane that let the key past would dismiss itself
		// and clear the selection behind it in the same press.
		const onKey = (ev: KeyboardEvent): void => {
			if (ev.key !== "Escape") return;
			ev.preventDefault();
			ev.stopPropagation();
			this.close();
		};
		document.addEventListener("keydown", onKey, true);
		this.cleanup = () => document.removeEventListener("keydown", onKey, true);
	}

	close(): void {
		const root = this.root;
		if (root === null) return;
		this.root = null;

		this.cleanup?.();
		this.cleanup = null;

		// A video that still has a source keeps its audio playing and its bytes
		// coming; taking the element out of the document stops neither.
		const video = root.querySelector("video");
		if (video) {
			video.pause();
			video.removeAttribute("src");
			video.load();
		}
		root.remove();

		const back = this.focusBack;
		this.focusBack = null;
		// Only while it is still in the document: the map may have been
		// repainted, or closed, with the preview up.
		if (back?.isConnected) back.focus({ preventScroll: true });
	}

	private buildImage(root: HTMLElement, src: string, label: string): void {
		const img = root.createEl("img", {
			cls: "mm-lightbox-el",
			attr: { src, alt: label, draggable: "false" },
		});

		const settle = (): void => {
			if (img.naturalWidth > 0 && img.naturalHeight > 0) {
				this.fit(img, img.naturalWidth, img.naturalHeight);
			}
		};
		// A picture already in the cache can report `complete` without ever
		// firing `load` at a listener attached afterwards -- the same trap
		// `media.ts` watches for, and the card having drawn it is exactly what
		// put it in the cache.
		if (img.complete) settle();
		else img.addEventListener("load", settle, { once: true });
	}

	private buildVideo(root: HTMLElement, src: string): void {
		const video = root.createEl("video", {
			cls: "mm-lightbox-el",
			attr: { src, controls: "", playsinline: "", autoplay: "" },
		});
		// Sound on purpose: this is the player, and the muted card is the
		// reason to come here. Allowed because the call sits inside the click
		// that opened it.
		video.muted = false;

		video.addEventListener(
			"loadedmetadata",
			() => {
				if (video.videoWidth > 0 && video.videoHeight > 0) {
					this.fit(video, video.videoWidth, video.videoHeight);
				}
			},
			{ once: true },
		);

		void video.play().catch((error: unknown) => {
			// A browser that refuses still leaves the controls up, which is a
			// better answer than a preview that does nothing.
			console.debug("MindFlow: the preview could not start this video.", error);
		});
	}

	/**
	 * The ✕ in the corner.
	 *
	 * Deliberately no click listener: a press on this is not the media, so the
	 * overlay's own rule closes the box, the same rule that handles the
	 * backdrop. What it does need is the keyboard, because `role="button"` on a
	 * div promises it -- `tabindex` alone makes the thing reachable and then
	 * does nothing when you get there.
	 */
	private buildClose(root: HTMLElement): void {
		const label = t("view.lightbox.close");
		const button = root.createDiv({ cls: "mm-lightbox-close" });
		button.setAttribute("role", "button");
		button.setAttribute("tabindex", "0");
		button.setAttribute("aria-label", label);
		button.setAttribute("title", label);
		setIcon(button, "x");
		// `setIcon` is silent when the id is not in the bundled set, which
		// would leave a circle with nothing in it to click.
		if (!button.firstElementChild) button.setText("✕");

		button.addEventListener("keydown", (ev) => {
			if (ev.key !== "Enter" && ev.key !== " ") return;
			ev.preventDefault();
			this.close();
		});
	}

	/**
	 * Size the element to fill the pane, without turning something small into a
	 * large blur.
	 *
	 * Written in pixels rather than left to `max-width`/`max-height`, and that
	 * is the point: an element sized to its content is only as big as the
	 * picture in it, so the empty space around it stays part of the backdrop
	 * and a click there still dismisses. An element stretched to the whole pane
	 * would swallow the very click that was meant to close it.
	 */
	private fit(el: HTMLElement, width: number, height: number): void {
		const paneWidth = this.container.clientWidth;
		const paneHeight = this.container.clientHeight;
		if (paneWidth === 0 || paneHeight === 0) return;

		const scale = Math.min(
			MAX_UPSCALE,
			(paneWidth * FILL) / width,
			(paneHeight * FILL) / height,
		);
		el.style.width = `${Math.max(1, Math.round(width * scale))}px`;
		el.style.height = `${Math.max(1, Math.round(height * scale))}px`;
	}
}

/** How much of the pane the preview may fill, as a fraction of each side. */
const FILL = 0.92;

/**
 * The most a picture is enlarged past its own size.
 *
 * A card caps a picture at a couple of hundred pixels, so the ordinary case --
 * a photograph, a screenshot -- is a real enlargement whatever this says. It
 * binds only on something genuinely small, where the alternative is a blurry
 * mess filling the pane.
 */
const MAX_UPSCALE = 2;
