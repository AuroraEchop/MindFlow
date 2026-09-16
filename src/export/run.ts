import { Notice } from "obsidian";
import type { App, TFile } from "obsidian";

import { t } from "../i18n.ts";
import type { I18nKey } from "../i18n.ts";
import { htmlDocument, svgDocument } from "./documents.ts";
import { nextFreePath, takenBy } from "./paths.ts";
import { rasterize } from "./raster.ts";
import type { Snapshot } from "./snapshot.ts";

/**
 * The vault side of exporting: where the file goes, what it is called, and what
 * the user is told about it.
 *
 * The map itself is built by the view and arrives through `ExportSource`, which
 * is what keeps this file out of the view's import cycle.
 */

export type ExportFormat = "canvas" | "svg" | "png" | "html";

export interface ExportCommand {
	/** Command id, as registered. */
	id: string;
	/** Where the command name, as shown in the palette, lives. */
	nameKey: I18nKey;
	/** Where the same thing, said shorter, for the tab's menu, lives. */
	menuKey: I18nKey;
	icon: string;
	format: ExportFormat;
}

/**
 * The dictionary key a format's palette name lives under.
 *
 * Derived from the format rather than written out, so a format added to the
 * union without its two strings produces a key the English table does not
 * hold -- and this stops compiling.
 */
export function exportNameKey(format: ExportFormat): I18nKey {
	return `export.${format}.name`;
}

/** The dictionary key a format's shorter menu label lives under. */
export function exportMenuKey(format: ExportFormat): I18nKey {
	return `export.${format}.menu`;
}

/** Declared once: the palette reads it, and so does the pane menu. */
export const EXPORT_COMMANDS: readonly ExportCommand[] = (
	[
		{ id: "export-canvas", icon: "layout-dashboard", format: "canvas" },
		{ id: "export-svg", icon: "file-code", format: "svg" },
		{ id: "export-png", icon: "image", format: "png" },
		{ id: "export-html", icon: "code", format: "html" },
	] as const
).map((entry) => ({
	id: entry.id,
	icon: entry.icon,
	format: entry.format,
	nameKey: exportNameKey(entry.format),
	menuKey: exportMenuKey(entry.format),
}));

export interface ExportSource {
	/** The `.canvas` file's text, or null when there is nothing on the map. */
	canvasFile(): string | null;
	/** The map as an XHTML fragment, or null when there is nothing on the map. */
	snapshot(): Snapshot | null;
}

/**
 * Beside the note, same basename, new extension -- and never over the top of
 * something that is already there.
 *
 * The folder's own listing is what is checked, rather than a lookup by exact
 * path: a vault path is case-sensitive and the disk under it usually is not.
 */
function freePath(app: App, file: TFile, ext: string): string {
	const folder = file.parent ?? app.vault.getRoot();
	const path = folder.path === "/" ? "" : folder.path;
	const exists = takenBy(folder.children.map((child) => child.name));
	return nextFreePath(exists, path, file.basename, ext);
}

export async function runExport(
	app: App,
	file: TFile | null,
	format: ExportFormat,
	source: ExportSource,
): Promise<void> {
	if (!file) {
		new Notice(t("export.notice.nothing"));
		return;
	}

	try {
		if (format === "canvas") {
			const text = source.canvasFile();
			if (text === null) {
				new Notice(t("export.notice.nothing"));
				return;
			}
			const created = await app.vault.create(freePath(app, file, "canvas"), text);
			// A canvas is something to work in rather than something to look at,
			// so it opens where the note can stay open beside it.
			await app.workspace.getLeaf(true).openFile(created);
			return;
		}

		const snapshot = source.snapshot();
		if (snapshot === null) {
			new Notice(t("export.notice.nothing"));
			return;
		}
		const title = file.basename;

		const { width, height, background } = snapshot;

		if (format === "html") {
			// The HTML serialization, not the XML one: an HTML parser reads
			// `<div/>` as a tag that was never closed.
			const created = await app.vault.create(
				freePath(app, file, "html"),
				htmlDocument({ body: snapshot.html, width, height, background, title }),
			);
			new Notice(t("export.notice.done", { path: created.path }));
			return;
		}

		const svg = svgDocument({ body: snapshot.xhtml, width, height, background, title });

		if (format === "svg") {
			const created = await app.vault.create(freePath(app, file, "svg"), svg);
			new Notice(t("export.notice.done", { path: created.path }));
			return;
		}

		const raster = await rasterize(svg, snapshot.width, snapshot.height);
		const created = await app.vault.createBinary(freePath(app, file, "png"), raster.data);
		new Notice(
			raster.clamped
				? t("export.notice.doneScaled", { path: created.path })
				: t("export.notice.done", { path: created.path }),
		);
	} catch (error) {
		console.error("MindFlow: the export failed.", error);
		const reason = error instanceof Error ? error.message : String(error);
		new Notice(t("export.notice.failed", { reason }));
	}
}
