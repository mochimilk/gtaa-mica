// A bar's menu on the board: right-clicking a bar (or its delay ghost), or
// Shift+F10 or the Menu key on a focused one, opens it with Unassign stand,
// as on the selection card (FlightCard), for that bar's stay, selected or
// not. It is disabled where the card's is: a bar waiting in the No stand
// lane, or a stay with no flight to give a stand again by.
//
// One menu for the whole board, not one per bar: like SelectionPopover, it
// finds the bar by its data-occupancy-id and leaves the reusable chart as it
// is. Its listener is on the element around the board, so a board drawn
// elsewhere (a chat's snippet) gets none.
import { useEffect, useRef, useState, type RefObject } from "react";
import { Menu, MenuItem, MenuList, MenuPopover, type PositioningVirtualElement } from "@fluentui/react-components";
import { CalendarCancel20Regular } from "@fluentui/react-icons";
import { flightsAtStay, occupancyById } from "./allocation";
import { useOpsActions } from "./OperationsContext";
import { KEEP_SELECTION_ATTR } from "./ViewsFiltersToolbar";

/** A bar, or a delay ghost, which stands for its bar (layers.tsx, BarGhosts). */
const BAR = "[data-occupancy-id], [data-ghost-of]";

interface BarMenuAt {
  stayId: string;
  /** Where focus goes back to when the menu closes. */
  bar: Element;
  /** The pointer, or the bar itself when the menu came from the keyboard. */
  target: Element | PositioningVirtualElement;
}

/** On a stand, with a flight to give it a stand again by: FlightCard's rule. */
const canUnassign = (stayId: string) => !!occupancyById(stayId) && flightsAtStay(stayId).length > 0;

const within = (x: number, y: number, rect: DOMRect) =>
  x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

/** The board's bar menu, for the bars inside `board`. */
export function FlightBarMenu({ board }: { board: RefObject<HTMLElement | null> }) {
  const { unassignStands } = useOpsActions();
  const [at, setAt] = useState<BarMenuAt | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Fluent gives focus back to a menu's trigger, and this one has none: back
  // to the bar instead, unless it has gone on somewhere (a click elsewhere,
  // or the details Unassign opens), or the bar has (Unassign moves it).
  const close = () => {
    const bar = at?.bar;
    setAt(null);
    requestAnimationFrame(() => {
      const active = document.activeElement;
      const lost = !active || active === document.body || !!popoverRef.current?.contains(active);
      if (lost && bar?.isConnected && (bar instanceof SVGElement || bar instanceof HTMLElement)) {
        bar.focus({ preventScroll: true });
      }
    });
  };

  useEffect(() => {
    const el = board.current;
    if (!el) return undefined;
    // A right-click anywhere else on the board closes it, and opens the app's
    // default menu (DefaultContextMenu) instead; on a bar, cancelling the
    // event keeps that one shut.
    const onContextMenu = (event: MouseEvent) => {
      const bar = event.target instanceof Element ? event.target.closest(BAR) : null;
      const stayId = bar?.getAttribute("data-occupancy-id") ?? bar?.getAttribute("data-ghost-of");
      if (!bar || !stayId) {
        setAt(null);
        return;
      }
      event.preventDefault();
      // At the pointer, as context menus open; from the keyboard, whose event
      // may carry no point on the bar, under the bar instead.
      const { clientX: x, clientY: y } = event;
      const target = within(x, y, bar.getBoundingClientRect())
        ? { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) }
        : bar;
      setAt({ stayId, bar, target });
    };
    el.addEventListener("contextmenu", onContextMenu);
    return () => el.removeEventListener("contextmenu", onContextMenu);
  }, [board]);

  return (
    <Menu
      open={!!at}
      onOpenChange={(_, data) => !data.open && close()}
      positioning={{ target: at?.target, position: "below", align: "start" }}
    >
      <MenuPopover ref={popoverRef} {...KEEP_SELECTION_ATTR}>
        <MenuList>
          <MenuItem
            icon={<CalendarCancel20Regular />}
            disabled={!at || !canUnassign(at.stayId)}
            onClick={() => at && canUnassign(at.stayId) && unassignStands([at.stayId])}
          >
            Unassign stand
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
