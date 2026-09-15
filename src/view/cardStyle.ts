/**
 * How a card is drawn, and the class the stylesheet keys it on.
 *
 * Here rather than in `settings.ts` because the interaction layer names the
 * same class when it copies a card for a drag, and that layer is tested against
 * a stubbed DOM with no Obsidian in it -- `settings.ts` pulls the plugin API in,
 * this does not. The same reason `EdgeStyle` lives in `edges.ts`.
 */

/**
 * `bordered` is the classic look: a border and background on every card, with
 * the depth rules drawing the root as a pill, the first level in its branch
 * colour, and the deeper levels on the line.
 *
 * `rounded` gives the whole map one kind of card -- the same quiet slab at every
 * depth, no border and no rule under the text -- so the hierarchy is carried by
 * the layout and the connectors alone.
 *
 * `minimal` draws nothing at rest: a card is its text on the canvas until it is
 * picked, and picking one draws a single frame around the card.
 */
export type CardStyle = "bordered" | "rounded" | "minimal";

/** Every card style, in the order the setting offers them. */
export const CARD_STYLES: CardStyle[] = ["bordered", "rounded", "minimal"];

/** The class a card style is drawn by, or `""` for `bordered`, which has none. */
export function cardStyleClass(style: CardStyle): string {
	return style === "bordered" ? "" : `mm-card-${style}`;
}

/**
 * The classes a drawn style is keyed on, with the default's empty string left
 * out. Toggled on the map, and copied onto the ghost a drag carries -- the ghost
 * is on `document.body` and inherits nothing, so a style class it does not get
 * is a copy that arrives looking like a different style.
 */
export const CARD_STYLE_CLASSES = CARD_STYLES.map(cardStyleClass).filter(
	(cls) => cls !== "",
);
