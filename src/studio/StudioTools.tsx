// The Studio's floating toolbar, down the left of the canvas area: the
// drawing tools, then undo, redo and clear. Symbols are one colour, set in
// the header, so there is no colour here. Each group is its own Tab stop,
// arrow keys moving within it.
import type { ReactElement } from "react";
import { Divider, Toolbar, ToolbarButton, ToolbarRadioButton, ToolbarRadioGroup, Tooltip } from "@fluentui/react-components";
import { ArrowRedo } from "@coral-ai/bundleicons/ArrowRedo";
import { ArrowUndo } from "@coral-ai/bundleicons/ArrowUndo";
import { Delete } from "@coral-ai/bundleicons/Delete";
import { Edit } from "@coral-ai/bundleicons/Edit";
import { Eraser } from "@coral-ai/bundleicons/Eraser";
import { PaintBucket } from "@coral-ai/bundleicons/PaintBucket";
import type { Tool } from "./PixelCanvas";

/** Each tool's name and keyboard shortcut, as its tooltip shows them. */
export const TOOLS: readonly { tool: Tool; label: string; key: string; icon: ReactElement }[] = [
  { tool: "pencil", label: "Pencil", key: "B", icon: <Edit /> },
  { tool: "eraser", label: "Eraser", key: "E", icon: <Eraser /> },
  { tool: "fill", label: "Fill", key: "G", icon: <PaintBucket /> },
];

export interface StudioToolsProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

export function StudioTools({ tool, onToolChange, canUndo, canRedo, canClear, onUndo, onRedo, onClear }: StudioToolsProps) {
  return (
    <div className="studio-tools" role="group" aria-label="Drawing tools">
      <Toolbar
        aria-label="Tool"
        vertical
        checkedValues={{ tool: [tool] }}
        onCheckedValueChange={(_, data) => data.name === "tool" && onToolChange(data.checkedItems[0] as Tool)}
      >
        <ToolbarRadioGroup>
          {TOOLS.map((t) => (
            <Tooltip key={t.tool} content={`${t.label} (${t.key})`} relationship="label" positioning="after">
              <ToolbarRadioButton name="tool" value={t.tool} appearance="subtle" icon={t.icon} />
            </Tooltip>
          ))}
        </ToolbarRadioGroup>
      </Toolbar>
      <Divider className="studio-tools-divider" />
      <Toolbar aria-label="Edit" vertical>
        <Tooltip content="Undo (Ctrl+Z)" relationship="label" positioning="after">
          <ToolbarButton icon={<ArrowUndo />} disabledFocusable={!canUndo} onClick={() => canUndo && onUndo()} />
        </Tooltip>
        <Tooltip content="Redo (Ctrl+Y)" relationship="label" positioning="after">
          <ToolbarButton icon={<ArrowRedo />} disabledFocusable={!canRedo} onClick={() => canRedo && onRedo()} />
        </Tooltip>
        <Tooltip content="Clear canvas" relationship="label" positioning="after">
          <ToolbarButton icon={<Delete />} disabledFocusable={!canClear} onClick={() => canClear && onClear()} />
        </Tooltip>
      </Toolbar>
    </div>
  );
}
