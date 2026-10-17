/**
 * The pane's own group of buttons, which is what a view's own things are put
 * beside.
 *
 * Asked by class rather than by walking to it, because the row is Obsidian's
 * and moves between versions: all any caller wants of it is the element that
 * says where "beside the pane's own controls" begins. Null when the pane has no
 * header at all -- a reader who has hidden theirs has no row for anything of
 * ours, and every caller here has to answer for that rather than assume it.
 *
 * One function for one string, so that a header button and a header path cannot
 * end up looking for two different rows.
 */
export function paneActions(containerEl: HTMLElement): HTMLElement | null {
	return containerEl.querySelector<HTMLElement>(".view-actions");
}

/**
 * The one slot a header toggle goes in, so that it does not move about.
 *
 * A note's header row ends with Obsidian's own "more options" button, and every
 * action a view adds with `addAction` lands wherever that view's own actions
 * start. The map's toggle and the editor's toggle are two different buttons
 * belonging to two different views, so nothing lines them up by itself: each
 * sat at the front of its own row, and on a row with a reading-view button in
 * it the front is not the same place at all. Pressing one and then the other
 * meant hunting for the icon that had moved.
 *
 * Both call this instead, and both land in the one slot that reads the same on
 * either row: immediately before the last action, which is Obsidian's button --
 * the second from the right of the header, so a toggle is a press in the same
 * place whichever way round the note is.
 *
 * Found by position rather than by name, because that button's label is
 * Obsidian's own and gets translated: there is no string to search for. There
 * are two layouts to survive and one rule covers both -- whether the button is
 * the row's last child (insert before it), or sits just after the row, in which
 * case the action is already the row's last child and stays there.
 */
export function placeHeaderSlot(row: HTMLElement, action: HTMLElement): void {
	const last = row.lastElementChild;
	if (last === null) {
		row.append(action);
		return;
	}
	// Already the last child with nothing of Obsidian's after it: in the layout
	// where the "more options" button lives outside this row, this *is* the
	// slot -- moving it would only push it further from the right edge.
	if (last === action) return;
	row.insertBefore(action, last);
}
