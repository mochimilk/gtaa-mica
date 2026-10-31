// The app's right-click menu wherever no other menu is: Cut, Copy and Paste,
// their shortcuts at the rows' end, for the text selected or the field
// right-clicked in. What can't apply there is disabled, so the menu is the
// same wherever it opens; with nothing selected and no field, all three are.
//
// A menu of the app's own (Fluent's <Menu openOnContext>, FlightBarMenu)
// cancels its right-click, and this one opens for any other. It listens on
// the document, in the bubble phase, after React's handlers on the root and
// its portals: Fluent skips an event already cancelled, so this must not run
// first. It cancels the rest, so the browser's own menu never opens.
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { PositioningVirtualElement } from "@fluentui/react-components";
import { ClipboardPaste } from "@coral-ai/bundleicons/ClipboardPaste";
import { Copy } from "@coral-ai/bundleicons/Copy";
import { Cut } from "@coral-ai/bundleicons/Cut";
import { KEEP_SELECTION_ATTR } from "../../operations/ViewsFiltersToolbar";
import { Menu, MenuItem, MenuList, MenuPopover } from "../menu";

type Command = "cut" | "copy" | "paste";

const COMMANDS: { command: Command; label: string; key: string; icon: ReactElement }[] = [
  { command: "cut", label: "Cut", key: "X", icon: <Cut /> },
  { command: "copy", label: "Copy", key: "C", icon: <Copy /> },
  { command: "paste", label: "Paste", key: "V", icon: <ClipboardPaste /> },
];

/** A shortcut as the platform writes it. */
const shortcut = (key: string) => (/Mac|iPhone|iPad/.test(navigator.platform) ? `⌘${key}` : `Ctrl+${key}`);

/** The inputs that take a line of text; the rest (checkboxes, dates…) take none. */
const TEXT_INPUTS = new Set(["text", "search", "url", "tel", "email", "password", "number"]);

type TextField = HTMLInputElement | HTMLTextAreaElement;

/** A field that takes typing: a text input or textarea, or rich text's editing host. */
type Field = TextField | HTMLElement;

interface MenuAt {
  /** The pointer, or the element itself when the menu came from the keyboard. */
  target: Element | PositioningVirtualElement;
  /** The field right-clicked in, if any. */
  field: Field | null;
  /**
   * The selection when the menu opened, which its focus takes away and a
   * command puts back first: a text field's offsets, or a range anywhere else.
   */
  selection: { start: number; end: number; direction: "forward" | "backward" | "none" } | Range | null;
  enabled: Record<Command, boolean>;
}

const isTextField = (field: Field | null): field is TextField =>
  field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement;

/** The field an element is in, if it takes typing now. */
function fieldOf(element: Element): Field | null {
  const field = element.closest("input, textarea");
  if (field instanceof HTMLInputElement) return TEXT_INPUTS.has(field.type) && !field.disabled ? field : null;
  if (field instanceof HTMLTextAreaElement) return field.disabled ? null : field;
  if (!(element instanceof HTMLElement) || !element.isContentEditable) return null;
  let host = element;
  while (host.parentElement?.isContentEditable) host = host.parentElement;
  return host;
}

const within = (x: number, y: number, rect: DOMRect) =>
  x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

/** The menu for a right-click: where it opens, and what it can do there. */
function menuAt(event: MouseEvent): MenuAt {
  const element = event.target instanceof Element ? event.target : document.documentElement;
  const field = fieldOf(element);
  let selection: MenuAt["selection"] = null;
  let selected = false;
  if (isTextField(field)) {
    // Email and number fields keep theirs to themselves (null), so they only paste.
    const { selectionStart: start, selectionEnd: end, selectionDirection: direction } = field;
    if (start !== null && end !== null) {
      selection = { start, end, direction: direction ?? "none" };
      selected = start !== end;
    }
  } else {
    const current = document.getSelection();
    if (current?.rangeCount) {
      selection = current.getRangeAt(0).cloneRange();
      selected = !current.isCollapsed && current.toString() !== "";
    }
  }
  const writable = !!field && !(isTextField(field) && field.readOnly);
  // As browsers do, a password never leaves its field.
  const secret = field instanceof HTMLInputElement && field.type === "password";
  // At the pointer, as context menus open; from the keyboard, whose event
  // may carry no point on the element, under the element instead.
  const { clientX: x, clientY: y } = event;
  const target = within(x, y, element.getBoundingClientRect())
    ? { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) }
    : element;
  return {
    target,
    field,
    selection,
    enabled: { cut: selected && writable && !secret, copy: selected && !secret, paste: writable },
  };
}

/** Gives the field its focus back, and the selection as it was when the menu opened. */
function restore({ field, selection }: MenuAt) {
  if (field?.isConnected) field.focus({ preventScroll: true });
  if (selection instanceof Range) {
    const current = document.getSelection();
    current?.removeAllRanges();
    current?.addRange(selection);
  } else if (selection && isTextField(field)) {
    field.setSelectionRange(selection.start, selection.end, selection.direction);
  }
}

/**
 * Does a command as its shortcut would, on the selection put back first:
 * through execCommand, which keeps the field's undo and fires the input
 * events React's fields listen to.
 */
function run(at: MenuAt, command: Command) {
  restore(at);
  if (command !== "paste") {
    document.execCommand(command);
  } else if (window.micaDesktop?.paste) {
    // The desktop app keeps the clipboard from the page (permissionPolicy.mjs),
    // so the shell pastes, as Ctrl+V does.
    void window.micaDesktop.paste();
  } else {
    // A browser asks the first time.
    const { field } = at;
    void navigator.clipboard
      ?.readText()
      .then((text) => field && document.activeElement === field && document.execCommand("insertText", false, text))
      .catch(() => {});
  }
}

/** The app's right-click menu, for wherever no other menu opens. */
export function DefaultContextMenu() {
  const [at, setAt] = useState<MenuAt | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      // A right-click on the menu itself leaves it as it is.
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return;
      setAt(menuAt(event));
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // Fluent gives focus back to a menu's trigger, and this one has none: back
  // to the field, as it was, unless focus has gone on somewhere (a click
  // elsewhere, or a command, which puts it back itself).
  const close = () => {
    const was = at;
    setAt(null);
    requestAnimationFrame(() => {
      const active = document.activeElement;
      const lost = !active || active === document.body || !!popoverRef.current?.contains(active);
      if (lost && was?.field) restore(was);
    });
  };

  return (
    <Menu
      open={!!at}
      onOpenChange={(_, data) => !data.open && close()}
      positioning={{ target: at?.target, position: "below", align: "start" }}
    >
      {/* Copying from the board keeps its selection. */}
      <MenuPopover ref={popoverRef} {...KEEP_SELECTION_ATTR}>
        <MenuList>
          {COMMANDS.map(({ command, label, key, icon }) => (
            <MenuItem
              key={command}
              icon={icon}
              secondaryContent={shortcut(key)}
              disabled={!at?.enabled[command]}
              onClick={() => at && run(at, command)}
            >
              {label}
            </MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
