import { setIcon } from "obsidian";
import type { App } from "obsidian";

import { t } from "../i18n.ts";
import { decodeTarget, mediaKindOf } from "../model/media.ts";

/**
 * Pictures and videos, drawn on the card.
 *
 * The map has always shown `![[hero.png]]` as a chip: the file's name, and a
 * click to open it. This draws the picture instead -- and the reason it is a
 * module of its own rather than a few lines in `inline.ts` is timing.
 *
 * A card is measured the instant it is built (`offsetWidth`/`offsetHeight`),
 * and a picture has no size until it has loaded. So a media element is drawn
 * empty, the load is watched here, and the view measures the card again once it
 * has landed. That is the same bargain `math.ts` strikes with MathJax, and it
 * is deliberately the same shape.
 *
 * The one thing this does that MathJax cannot is remember. A paint rebuilds
 * every card in the note, so a picture that had to be measured twice would be
 * measured twice on every keystroke; `MediaContext.sizes` holds the natural
 * size of everything that has ever loaded, and a picture whose size is already
 * known is drawn at it in the first pass, with no second measurement at all.
 *
 * Two things are deliberately *not* left to the browser's own lazy loading.
 * The source is not attached until the card is on screen -- see `activateMedia`
 * -- because a culled card is `display: none` rather than absent, so an eager
 * source would fetch every picture in the note on every paint. And only vault
 * files are drawn: a remote `![](https://...)` stays the chip it has always
 * been, because a map that phones out to every host a note mentions is not a
 * map anybody asked for.
 */

export interface MediaSize {
	width: number;
	height: number;
}

export interface MediaContext {
	app: App;
	/** The note's path, so `[[hero.png]]` resolves the way the note reads. */
	sourcePath: string;
	/** The widest a picture may be drawn, in CSS pixels. */
	maxWidth: number;
	/** The tallest. What keeps one photograph from owning the map. */
	maxHeight: number;
	/**
	 * Natural sizes, by resource URL. Owned by the view, and thrown away with
	 * the math cache when the note changes.
	 */
	sizes: Map<string, MediaSize>;
	/**
	 * A media element finished loading, so some card is a size it was not
	 * measured at. Called once per element, from the load itself.
	 */
	onSettled: () => void;
}

/** The mark a media element carries once it has nothing left to load. */
const READY = "data-media-ready";

/** The source an element is holding but has not attached yet. */
const SRC = "data-media-src";

/**
 * Attach the sources of the media inside `root` that are actually on screen.
 *
 * Called by the view once the cards are in the document, and again for each
 * card a cull brings back. A card the cull is holding down is skipped: it is
 * `display: none`, so its picture would be fetched and decoded to be drawn
 * nowhere.
 */
export function activateMedia(root: HTMLElement): void {
	for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${SRC}]`))) {
		if (el.closest(".is-offscreen")) continue;
		const src = el.dataset.mediaSrc;
		if (src === undefined) continue;
		// Removed rather than left behind, so a second pass over the same card
		// -- the cull's, on the frame it comes back -- is a no-op.
		delete el.dataset.mediaSrc;
		el.setAttribute("src", src);
	}
}

/**
 * Whether this card holds media that has not reported in yet.
 *
 * What the cull asks before it measures a card it has just put back. A picture
 * that has not loaded measures as nothing, and a card measured as nothing is a
 * card the whole map is laid out around -- so the measurement is left to the
 * flush that follows the load instead.
 */
export function mediaLoading(card: HTMLElement): boolean {
	return card.querySelector(`.mm-media:not([${READY}])`) !== null;
}

/**
 * Resolves once every media element under `root` has loaded or failed.
 *
 * The export's half of `onSettled`. A file is not a frame that the next pan
 * corrects, so the map it is read from has to be the finished one -- and the
 * cards the cull had been holding down have never fetched anything at all
 * until `activateMedia` is called on them.
 *
 * Bounded, because a wait with no end in it is a hung export rather than a slow
 * one: an element that reports neither way after this long is treated as one
 * that reported, and the file carries the empty box the map was showing.
 */
const READY_TIMEOUT_MS = 8000;

export function whenMediaReady(root: HTMLElement): Promise<void> {
	const wraps: HTMLElement[] = [];
	const waiting: Array<Promise<void>> = [];
	for (const el of Array.from(root.querySelectorAll<HTMLElement>(".mm-media-el"))) {
		const wrap = el.closest<HTMLElement>(".mm-media");
		if (wrap === null || wrap.hasAttribute(READY)) continue;
		wraps.push(wrap);
		waiting.push(
			new Promise((resolve) => {
				const finish = (): void => {
					wrap.setAttribute(READY, "1");
					resolve();
				};
				el.addEventListener("load", finish, { once: true });
				el.addEventListener("loadedmetadata", finish, { once: true });
				el.addEventListener("error", finish, { once: true });
			}),
		);
	}
	if (waiting.length === 0) return Promise.resolve();

	return new Promise<void>((resolve) => {
		let done = false;
		const finish = (): void => {
			if (done) return;
			done = true;
			window.clearTimeout(timer);
			resolve();
		};
		const timer = window.setTimeout(() => {
			console.warn("MindFlow: some media did not finish loading before the export.");
			// Marked anyway. An element the map is still waiting on is one
			// `measureUnmeasured` would skip for good, and a card that can never
			// be measured again is worse than a card measured as an empty box.
			for (const wrap of wraps) wrap.setAttribute(READY, "1");
			finish();
		}, READY_TIMEOUT_MS);
		void Promise.all(waiting).then(finish);
	});
}

/**
 * Draw `target` as media, and say whether it was drawn.
 *
 * False is the ordinary answer for most embeds: a PDF, a note, a link to
 * somewhere else. The caller falls back to the chip it has always drawn, which
 * is why this never has to explain itself on the card.
 *
 * `maxWidth` is the note's own `|300` hint, which narrows the card's cap rather
 * than replacing it: a note asking for a picture 300 wide on a card capped at
 * 200 gets 200.
 */
export function renderMedia(
	el: HTMLElement,
	target: string,
	label: string,
	ctx: MediaContext,
	maxWidth?: number,
): boolean {
	const file = ctx.app.metadataCache.getFirstLinkpathDest(decodeTarget(target), ctx.sourcePath);
	if (!file) return false;

	// The resolved file's own extension, not the target's: `![[hero]]` is a
	// picture when `hero.png` is the only match, and the vault is what says so.
	const kind = mediaKindOf(file.path);
	if (kind === null) return false;

	const src = ctx.app.vault.getResourcePath(file);
	const capped: MediaContext =
		maxWidth === undefined || maxWidth <= 0
			? ctx
			: { ...ctx, maxWidth: Math.min(ctx.maxWidth, maxWidth) };
	if (kind === "image") return drawImage(el, src, file.path, target, label, capped);
	return drawVideo(el, src, file.path, target, label, capped);
}

/**
 * A box that fits a picture inside both caps and keeps its shape.
 *
 * `natural` is how wide the thing would be if nothing stopped it, which for a
 * picture is its own width and for a video is the cap -- a video is drawn as
 * wide as the card allows and the height follows.
 */
function fitBox(
	ratio: number,
	natural: number,
	maxWidth: number,
	maxHeight: number,
): MediaSize {
	const width = Math.max(1, Math.round(Math.min(natural, maxWidth, maxHeight * ratio)));
	return { width, height: Math.max(1, Math.round(width / ratio)) };
}

/**
 * The wrapper every media element shares.
 *
 * It carries two things rather than one. `data-href` is the link the note
 * wrote, which is what a click follows -- the same contract the chip has, and
 * only the view decides what it means. `data-media-path` is the vault file that
 * link resolved to, which is what the export needs to read the bytes back out;
 * a link is resolved against a note, and an exported file has no note.
 */
function wrapFor(el: HTMLElement, cls: string, href: string, path: string): HTMLElement {
	const wrap = el.createSpan({ cls: `mm-media ${cls}` });
	wrap.dataset.href = href;
	wrap.dataset.mediaPath = path;
	// A click is a preview now rather than a trip to another tab, and nothing
	// drawn on the card says so. The tooltip is the cheapest place to say it --
	// and the only affordance that costs no room on a map.
	wrap.setAttribute("title", t("view.media.preview"));
	return wrap;
}

function drawImage(
	el: HTMLElement,
	src: string,
	path: string,
	href: string,
	label: string,
	ctx: MediaContext,
): boolean {
	const wrap = wrapFor(el, "mm-media-image", href, path);
	const img = wrap.createEl("img", { cls: "mm-media-el" });
	// The alt text the note wrote is the alt text the card carries, so a
	// picture that fails to load still says what it was.
	img.alt = label;
	img.setAttribute("draggable", "false");

	const known = ctx.sizes.get(src);
	if (known) {
		// Seen before: drawn at its real size in the same pass it was built in,
		// which is what keeps a keystroke from costing a second measurement.
		sizeImage(img, known, ctx);
		img.setAttribute(SRC, src);
		wrap.setAttribute(READY, "1");
		return true;
	}

	img.setAttribute(SRC, src);
	watch(img, wrap, () => {
		const natural = { width: img.naturalWidth, height: img.naturalHeight };
		if (natural.width === 0 || natural.height === 0) return;
		ctx.sizes.set(src, natural);
		sizeImage(img, natural, ctx);
	}, ctx);
	return true;
}

/**
 * Pin a picture's box in pixels.
 *
 * Explicit, rather than `max-width`/`max-height` on the element: the card is
 * `max-content`, so a picture left to size itself would have its intrinsic
 * width counted into the card's own width and then clamped, and the two would
 * disagree by exactly the clamp.
 */
function sizeImage(img: HTMLImageElement, natural: MediaSize, ctx: MediaContext): void {
	const box = fitBox(natural.width / natural.height, natural.width, ctx.maxWidth, ctx.maxHeight);
	img.style.width = `${box.width}px`;
	img.style.height = `${box.height}px`;
}

function drawVideo(
	el: HTMLElement,
	src: string,
	path: string,
	href: string,
	label: string,
	ctx: MediaContext,
): boolean {
	const wrap = wrapFor(el, "mm-media-video", href, path);
	// The name the note gave it, read out where the picture cannot be: a card
	// of five videos is five unlabelled black boxes to a screen reader
	// otherwise.
	wrap.setAttribute("aria-label", label);

	// A 16:9 box from the first frame, so the card is measured at a size that
	// is already plausible even when nothing has loaded yet.
	const known = ctx.sizes.get(src);
	const box = known
		? fitBox(known.width / known.height, ctx.maxWidth, ctx.maxWidth, ctx.maxHeight)
		: fitBox(16 / 9, ctx.maxWidth, ctx.maxWidth, ctx.maxHeight);
	wrap.style.width = `${box.width}px`;
	wrap.style.height = `${box.height}px`;

	const video = wrap.createEl("video", { cls: "mm-media-el" });
	video.muted = true;
	video.setAttribute("playsinline", "");
	// Metadata and no more: the frame is what a card needs, and a map that
	// downloaded every video in a note would be a map nobody could open.
	video.setAttribute("preload", "metadata");
	video.setAttribute(SRC, src);

	// Two buttons, and neither is the card's own click: one plays here, the
	// other hands the file to Obsidian, whose player is the one with the
	// scrubber, the volume and the full screen.
	const play = mediaButton(wrap, "mm-media-play", "play", t("view.media.play"), "▶");
	const open = mediaButton(wrap, "mm-media-open", "external-link", t("view.media.open"), "⧉");

	play.addEventListener("click", (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		wrap.addClass("is-playing");
		// Once it is a player, the card is not a link: the native controls need
		// the press that pauses, and the `⧉` button beside them is how a reader
		// still gets to Obsidian's own window.
		delete wrap.dataset.href;
		video.muted = false;
		video.controls = true;
		void video.play().catch((error: unknown) => {
			// A refused play leaves the native controls in place, which is a
			// better answer than a card that silently does nothing.
			console.error("MindFlow: could not play this video.", error);
		});
	});
	open.addEventListener("click", (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		void ctx.app.workspace.openLinkText(path, ctx.sourcePath, true);
	});

	if (known) {
		wrap.setAttribute(READY, "1");
		return true;
	}

	watch(video, wrap, () => {
		const natural =
			video.videoWidth > 0 && video.videoHeight > 0
				? { width: video.videoWidth, height: video.videoHeight }
				: { width: 16, height: 9 };
		ctx.sizes.set(src, natural);
		const fitted = fitBox(natural.width / natural.height, ctx.maxWidth, ctx.maxWidth, ctx.maxHeight);
		wrap.style.width = `${fitted.width}px`;
		wrap.style.height = `${fitted.height}px`;
		// `preload="metadata"` on its own leaves the element black: the browser
		// has the header and has decoded nothing. Asking for a time is what
		// makes it produce a frame, and a tenth of a second in is far enough
		// past a fade-in to be worth looking at.
		if (Number.isFinite(video.duration) && video.duration > 0) {
			try {
				video.currentTime = Math.min(0.1, video.duration / 2);
			} catch (error) {
				// A stream that cannot be seeked is still playable, and the play
				// button is what a reader presses either way.
				console.debug("MindFlow: this video cannot be seeked.", error);
			}
		}
	}, ctx);
	return true;
}

/** One of the two circles in the corner of a video card. */
function mediaButton(
	wrap: HTMLElement,
	cls: string,
	icon: string,
	label: string,
	fallback: string,
): HTMLElement {
	const button = wrap.createDiv({ cls: `mm-media-button ${cls}` });
	button.setAttribute("role", "button");
	button.setAttribute("aria-label", label);
	button.setAttribute("title", label);
	setIcon(button, icon);
	// `setIcon` is silent when the id is not in the bundled set, which would
	// leave an invisible but clickable circle over the picture.
	if (!button.firstElementChild) button.setText(fallback);
	return button;
}

/**
 * Run `after` when `el` has loaded, or when it has failed.
 *
 * `error` is what makes this safe to wait on: a note naming a picture that has
 * since been deleted would otherwise leave a card the map never measures again.
 * The two events are one outcome here, because the view's answer to both is the
 * same -- mark it, size it if there is anything to size, and let the empty box
 * stand.
 *
 * The mark goes on before `after`, not after it, for exactly that reason: a
 * picture that failed has nothing to size and would otherwise never be marked,
 * and an unmarked card is one `measureUnmeasured` skips for good.
 */
function watch(
	el: HTMLElement,
	wrap: HTMLElement,
	after: () => void,
	ctx: MediaContext,
): void {
	let done = false;
	const finish = (): void => {
		if (done) return;
		done = true;
		wrap.setAttribute(READY, "1");
		after();
		ctx.onSettled();
	};
	el.addEventListener("load", finish, { once: true });
	el.addEventListener("loadedmetadata", finish, { once: true });
	el.addEventListener("error", finish, { once: true });
}
