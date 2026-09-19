/**
 * Where the branch colours come from.
 *
 * Here rather than in `settings.ts` for the same reason `CardStyle` is: the
 * stylesheet and the settings tab both have to agree on the name, and this is
 * the one place that names it -- with no Obsidian import, so a test can read
 * the list without an app.
 *
 * A palette is a set of ten hues, `--mm-b0` through `--mm-b9`, and nothing
 * else changes with it: the edges, the branch buttons, the first level of every
 * branch and the minimap all read those ten, so choosing a palette re-colours
 * the whole map and nothing has to be told which palette is on.
 */

/**
 * `classic` is the ten the map has always drawn with: fixed hues, picked to be
 * told apart from each other rather than to match anything in particular.
 *
 * `theme` reads the vault's own palette instead -- the `--color-*` variables
 * Obsidian defines and a theme has usually already tuned -- so a map in a warm
 * vault is warm, and a map in a monochrome one stays quiet. The accent leads,
 * because it is the one colour the user picked by hand.
 */
export type Palette = "classic" | "theme";

/** Every palette, in the order the setting offers them. */
export const PALETTES: Palette[] = ["classic", "theme"];

/**
 * The palettes `styles.css` has to name, which is every one but the default.
 *
 * `classic` is what the ten variables are declared with at the top of the
 * file, so it is the absence of an attribute rather than a value of one --
 * which is also what keeps a map drawn by an older build, with no attribute at
 * all, looking exactly as it did.
 */
export const DRAWN_PALETTES: Palette[] = PALETTES.filter((palette) => palette !== "classic");
