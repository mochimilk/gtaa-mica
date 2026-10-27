import { useCallback, useSyncExternalStore } from "react";

/*
 * Which of Ask Skye's windows is open: the chat, or a window floating above
 * the bar (AskFloatingWindow, e.g. Alerts). Only one is open at a time, so
 * opening one closes whichever was open.
 */
let openPanel: string | null = null;
const listeners = new Set<() => void>();

function setOpenPanel(next: string | null) {
  if (next === openPanel) return;
  openPanel = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the window `id` is open, and a setter that closes any other on opening it. */
export function useAskPanel(id: string): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(subscribe, () => openPanel === id);
  const setOpen = useCallback(
    (next: boolean) => {
      if (next) setOpenPanel(id);
      else if (openPanel === id) setOpenPanel(null);
    },
    [id],
  );
  return [open, setOpen];
}

/** Whether any of Ask Skye's windows is open. */
export const useAnyAskPanelOpen = () => useSyncExternalStore(subscribe, () => openPanel !== null);

/** Closes whichever window is open. */
export const closeAskPanels = () => setOpenPanel(null);
