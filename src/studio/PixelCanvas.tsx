// The Studio's canvas: a drawing's GRID × GRID pixels, large, to paint on.
// Drag to turn pixels on with the pencil or off with the eraser; the fill
// tool turns on the whole empty region clicked. From the keyboard it is one grid: arrow keys move the cursor,
// Space or Enter uses the tool there.
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { GRID, fill, paintLine, type Pixels } from "./drawings";

export type Tool = "pencil" | "eraser" | "fill";

export interface PixelCanvasProps {
  pixels: Pixels;
  /** What the drawing is for, in the canvas's accessible name, e.g. "XB210/211". */
  label: string;
  tool: Tool;
  /** A stroke begins, before its first change: the moment to keep the pixels for undo. */
  onStrokeStart: () => void;
  onChange: (pixels: Pixels) => void;
}

const MOVES: Partial<Record<string, [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function PixelCanvas({ pixels, label, tool, onStrokeStart, onChange }: PixelCanvasProps) {
  const id = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  // The pixels as of the last change, ahead of the re-render that brings them back as props.
  const latest = useRef(pixels);
  latest.current = pixels;
  // The pixel the stroke under way was last seen at; null between strokes.
  const stroke = useRef<number | null>(null);
  const [cursor, setCursor] = useState(Math.floor((GRID * GRID) / 2));

  const commit = (next: Pixels) => {
    if (next === latest.current) return;
    latest.current = next;
    onChange(next);
  };
  /** The tool at `index`, along the line from `from` for a pencil or eraser stroke. */
  const use = (index: number, from = index) => {
    if (tool === "fill") commit(fill(latest.current, index, true));
    else commit(paintLine(latest.current, from, index, tool === "pencil"));
  };

  const pixelAt = (e: PointerEvent) => {
    const box = gridRef.current!.getBoundingClientRect();
    const col = Math.floor(((e.clientX - box.left) / box.width) * GRID);
    const row = Math.floor(((e.clientY - box.top) / box.height) * GRID);
    return col < 0 || row < 0 || col >= GRID || row >= GRID ? null : row * GRID + col;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const index = pixelAt(e);
    if (index === null) return;
    e.preventDefault();
    // Focus without the keyboard cursor (it shows only on focus-visible), so shortcuts reach the canvas.
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    stroke.current = index;
    setCursor(index);
    onStrokeStart();
    use(index);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const from = stroke.current;
    if (from === null || tool === "fill") return;
    const index = pixelAt(e);
    if (index === null || index === from) return;
    use(index, from);
    stroke.current = index;
  };

  const endStroke = () => {
    stroke.current = null;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const move = MOVES[e.key];
    if (move) {
      e.preventDefault();
      const col = Math.min(GRID - 1, Math.max(0, (cursor % GRID) + move[0]));
      const row = Math.min(GRID - 1, Math.max(0, Math.floor(cursor / GRID) + move[1]));
      setCursor(row * GRID + col);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      onStrokeStart();
      use(cursor);
    }
  };

  const cellId = (index: number) => `${id}-pixel-${index}`;
  const rows = Array.from({ length: GRID }, (_, row) => row);
  return (
    <>
      <div
        ref={gridRef}
        className={`studio-canvas studio-canvas--${tool}`}
        role="grid"
        tabIndex={0}
        aria-label={`Drawing for ${label}, ${GRID} by ${GRID} pixels`}
        aria-describedby={`${id}-hint`}
        aria-activedescendant={cellId(cursor)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onLostPointerCapture={endStroke}
        onKeyDown={onKeyDown}
      >
        {rows.map((row) => (
          <div key={row} role="row" className="studio-canvas-row">
            {rows.map((col) => {
              const index = row * GRID + col;
              const on = pixels[index];
              const classes = ["studio-pixel"];
              if (on) classes.push("studio-pixel--on");
              else if ((row + col) % 2) classes.push("studio-pixel--alt");
              if (index === cursor) classes.push("studio-pixel--cursor");
              return (
                <div
                  key={col}
                  id={cellId(index)}
                  role="gridcell"
                  className={classes.join(" ")}
                  aria-label={`Row ${row + 1}, column ${col + 1}: ${on ? "on" : "off"}`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <p id={`${id}-hint`} className="studio-visually-hidden">
        Arrow keys move between pixels. Space or Enter uses the tool on the pixel.
      </p>
    </>
  );
}
