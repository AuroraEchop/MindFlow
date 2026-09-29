/**
 * What a tag is worth to a map.
 *
 * A tag is the one piece of markdown that says what a card is *about* without
 * saying where it sits -- a heading is a place, a link is a destination, and a
 * tag is neither. The card draws one as a badge, and for a long time that was
 * the whole of it: the map did not filter by it, because a badge that looked
 * pressable and was not would have been the worse lie.
 *
 * This is the other half. It answers two questions and nothing else: what tags
 * a piece of note text carries, and which cards stay on the map when one of
 * them is the filter.
 */

import type { MindNode } from "./types.ts";

/**
 * One tag, as written: the `#` that opens it, and the characters after it.
 *
 * The same pattern `inlineText.ts` draws the badge from, and kept in step with
 * it by hand rather than shared: the rule there consumes the character in front
 * of the `#` to say it was allowed to be there, which is the shape an emitter
 * needs and a collector does not.
 */
const TAG = /(^|[\s(])#([^\s#\d][^\s#]*)/g;

/**
 * A tag as a filter names it: no `#`, and lowercase, because `#Tag` and `#tag`
 * are one tag -- which is what Obsidian says too.
 */
export function normaliseTag(tag: string): string {
	return tag.replace(/^#/, "").trim().toLowerCase();
}

/** Every tag in `text`, lowercase and without the `#`. */
export function tagsIn(text: string): string[] {
	const out: string[] = [];
	TAG.lastIndex = 0;
	for (let m = TAG.exec(text); m !== null; m = TAG.exec(text)) {
		out.push(normaliseTag(m[2]));
	}
	return out;
}

/**
 * Whether `text` carries `tag`.
 *
 * A nested tag counts as the one above it: `#work/todo` is under `#work`, which
 * is how Obsidian's own tag pane reads it, and a filter for `#work` that left
 * `#work/todo` behind would be a filter nobody asked for. It is the one place
 * this module reads a `/` as structure rather than as a character.
 */
export function hasTag(text: string, tag: string): boolean {
	const wanted = normaliseTag(tag);
	if (wanted === "") return false;
	return tagsIn(text).some((found) => found === wanted || found.startsWith(`${wanted}/`));
}

/**
 * The cards a filter leaves alone, as their keys.
 *
 * A card stays when it carries the tag itself *or* when something under it
 * does. The second half is the whole point: a match buried three levels down
 * with its branch faded out is a match with nothing around it, and the reader
 * cannot tell what they are looking at. So the branch is context and comes
 * back with it -- which is also why the answer is a set of keys rather than a
 * list of matches.
 *
 * `bodyText` is what a note-content card under the node says, or a function
 * that says nothing when the caller has no document to hand. A tag written in
 * a paragraph is a tag on the card that draws it, and that card hangs under
 * the same node.
 *
 * An empty list of tags is no filter, and the set comes back empty rather than
 * full: it is read as "nothing is filtered", never as "everything is".
 */
export function tagFilterKeys(
	root: MindNode,
	tags: readonly string[],
	bodyText: (node: MindNode) => string = () => "",
): Set<string> {
	const keys = new Set<string>();
	const wanted = tags.map(normaliseTag).filter((tag) => tag !== "");
	if (wanted.length === 0) return keys;

	const carries = (node: MindNode): boolean => {
		const text = `${node.text}\n${bodyText(node)}`;
		return wanted.some((tag) => hasTag(text, tag));
	};

	const visit = (node: MindNode): boolean => {
		let below = false;
		for (const child of node.children) if (visit(child)) below = true;
		if (below || carries(node)) {
			keys.add(node.key);
			return true;
		}
		return false;
	};
	visit(root);
	return keys;
}
