// Dragging a resize handle, as Coral's panels do: @coral-ai/react's
// usePanelResize, which it does not export, copied, and for either axis. From
// a press on the handle, each move reports how far the pointer has gone since,
// until the button is let go, Escape is pressed, or the window loses focus or
// is hidden. Text cannot be selected meanwhile.
import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";

function startDragResize(doc: Document, onMove: (event: MouseEvent) => void): () => void {
  const win = doc.defaultView;
  const style = doc.body.style;
  const properties = ["user-select", "-webkit-user-select"];
  const previous = properties.map((name) => ({
    name,
    value: style.getPropertyValue(name),
    priority: style.getPropertyPriority(name),
  }));
  let active = true;
  const preventSelection = (event: Event) => event.preventDefault();
  const move = (event: MouseEvent) => {
    if (!(event.buttons & 1)) {
      stop();
      return;
    }
    event.preventDefault();
    onMove(event);
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") stop();
  };
  const visibilitychange = () => {
    if (doc.hidden) stop();
  };
  const stop = () => {
    if (!active) return;
    active = false;
    doc.removeEventListener("mousemove", move, { capture: true });
    doc.removeEventListener("mouseup", stop, { capture: true });
    doc.removeEventListener("selectstart", preventSelection, { capture: true });
    doc.removeEventListener("keydown", keydown, { capture: true });
    doc.removeEventListener("visibilitychange", visibilitychange);
    win?.removeEventListener("blur", stop);
    for (const { name, value, priority } of previous) {
      if (value) style.setProperty(name, value, priority);
      else style.removeProperty(name);
    }
  };
  for (const name of properties) style.setProperty(name, "none", "important");
  doc.addEventListener("mousemove", move, { capture: true });
  doc.addEventListener("mouseup", stop, { capture: true });
  doc.addEventListener("selectstart", preventSelection, { capture: true });
  doc.addEventListener("keydown", keydown, { capture: true });
  doc.addEventListener("visibilitychange", visibilitychange);
  win?.addEventListener("blur", stop);
  return stop;
}

/**
 * The handle's onMouseDown: `onResize` hears how far the pointer has moved
 * along `axis` since the press, as it moves. A drag under way stops once
 * `enabled` turns false, and on unmount.
 */
export function useDragResize(
  axis: "x" | "y",
  enabled: boolean,
  onResize: (delta: number) => void,
): (event: ReactMouseEvent<HTMLElement>) => void {
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!enabled) stopRef.current?.();
    return () => stopRef.current?.();
  }, [enabled]);
  return (event) => {
    if (!enabled || event.button !== 0) return;
    event.preventDefault();
    stopRef.current?.();
    const start = axis === "x" ? event.clientX : event.clientY;
    stopRef.current = startDragResize(event.currentTarget.ownerDocument, (move) => {
      onResize((axis === "x" ? move.clientX : move.clientY) - start);
    });
  };
}
