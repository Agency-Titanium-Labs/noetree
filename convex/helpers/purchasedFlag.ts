/**
 * ONE definition of "this note holds purchased marketplace content"
 * (18-CONTEXT D-06). Pure and import-free so context assembly, the listing
 * guard and the copy helpers all share it.
 *
 * A note is purchased when it is a delivered copy root (`purchaseId`) OR it
 * carries the sticky `isPurchasedContent` flag. The flag is written by
 * purchase delivery on every copied note and propagated by duplication; it is
 * never cleared by edits or moves, so purchased text stays excluded wherever
 * the note ends up in the tree.
 */
export type PurchasedMarkers = {
  purchaseId?: unknown;
  isPurchasedContent?: boolean;
};

export function isPurchasedNote(note: PurchasedMarkers): boolean {
  return note.purchaseId !== undefined || note.isPurchasedContent === true;
}
