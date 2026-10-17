/**
 * Somewhere a keystroke means a character rather than a command.
 *
 * Asked by the two listeners that have to keep their hands off such a place:
 * the keyboard, whose table belongs to the field while a field has the focus,
 * and the paste, which belongs to the field for exactly the same reason. The
 * question is a fact about the document rather than about the map, so it is
 * answered once, here, rather than twice over by the two callers.
 *
 * A module of its own rather than a function in either caller, because the
 * paste module is read by `node --test`, where `obsidian` does not exist -- and
 * a file that had to import the map to ask this could not be.
 */

export function inTextField(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		target.tagName === "INPUT" ||
		target.tagName === "TEXTAREA"
	);
}
