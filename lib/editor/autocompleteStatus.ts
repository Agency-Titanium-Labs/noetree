import { useSyncExternalStore } from "react";

/**
 * Tiny external store shared by the editor bridge (writer) and the toolbar
 * toggle (reader): the quiet "paused" state of autocomplete (D-06: limits and
 * the kill switch pause it silently, no toast) and the screen reader
 * announcement of the suggestion on screen.
 */

export type AutocompleteStatus = {
  paused: boolean;
  /** Text for the polite live region; "" when no suggestion is shown. */
  announcement: string;
};

let status: AutocompleteStatus = { paused: false, announcement: "" };
const listeners = new Set<() => void>();

function set(next: Partial<AutocompleteStatus>) {
  const merged = { ...status, ...next };
  if (
    merged.paused === status.paused &&
    merged.announcement === status.announcement
  ) {
    return;
  }
  status = merged;
  for (const l of listeners) l();
}

export function setAutocompletePaused(paused: boolean) {
  set({ paused });
}

export function setAutocompleteAnnouncement(announcement: string) {
  set({ announcement });
}

export function resetAutocompleteStatus() {
  set({ paused: false, announcement: "" });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => status;

export function useAutocompleteStatus(): AutocompleteStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
