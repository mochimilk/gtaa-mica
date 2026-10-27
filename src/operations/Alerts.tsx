// Synthetic demo alerts, most pressing first (see currentAlerts). Each is a
// row that selects its flight, with a menu (on hover) to archive it; archived
// alerts, and those Skye has acknowledged, are left out.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { Button, Caption1, Caption1Strong, Tag, Tooltip } from "@fluentui/react-components";
import {
  Archive16Regular,
  bundleIcon,
  Info20Regular,
  MoreVertical20Filled,
  MoreVertical20Regular,
  PersonRunning20Regular,
} from "@fluentui/react-icons";
import { AirplaneOff20Regular } from "../components/custom-icons";
import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from "../components/menu";
import { isFlightSelected, useOperations } from "./OperationsContext";
import { currentAlerts, type AlertKind, type OpsAlert } from "./boardAlerts";
import { OPS_FLIGHTS_BY_ID } from "./operationsData";
import { KEEP_SELECTION_ATTR } from "./ViewsFiltersToolbar";

const ICONS: Record<AlertKind, ComponentType> = {
  conflict: PersonRunning20Regular,
  no_stand: AirplaneOff20Regular,
  notice: Info20Regular,
};

const MoreIcon = bundleIcon(MoreVertical20Filled, MoreVertical20Regular);

/**
 * `onSelect` runs after an alert's flight is selected (the Alerts menu
 * closes). `compact`: Skye's short list while she talks about the alerts,
 * two and a half alerts tall, scrolled to `mentioned`, the one she is on,
 * which is picked out.
 */
export function Alerts({
  onSelect,
  compact = false,
  mentioned = null,
}: {
  onSelect?: () => void;
  compact?: boolean;
  mentioned?: string | null;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const { acknowledged, matcher } = useOperations();
  // Alerts follow the filters (not the view; see opsFilters.ts).
  const all = currentAlerts();
  const open = all.filter((a) => !acknowledged.has(a.id));
  const shown = open.filter(matcher.alert);

  // Compact: as tall as two alerts and half the next, however tall they are.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (!compact) {
      list.style.maxHeight = "";
      return;
    }
    const rows = [...list.children] as HTMLElement[];
    const tall = (index: number) => rows[index]?.offsetHeight ?? 0;
    list.style.maxHeight = rows.length > 2 ? `${tall(0) + tall(1) + tall(2) / 2}px` : "";
  }, [compact, shown.length]);

  // The one Skye is on, brought into view in the short list. Only the list
  // scrolls: scrollIntoView would scroll the window around it too.
  useEffect(() => {
    const list = listRef.current;
    const row = mentioned ? list?.querySelector<HTMLElement>(`[data-alert-id="${CSS.escape(mentioned)}"]`) : null;
    if (!list || !row) return;
    const top = row.offsetTop - list.offsetTop;
    const bottom = top + row.offsetHeight;
    const to = top < list.scrollTop ? top : bottom > list.scrollTop + list.clientHeight ? bottom - list.clientHeight : null;
    if (to !== null) list.scrollTo({ top: to, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [mentioned]);

  return shown.length === 0 ? (
    <p className="ops-empty ops-alerts-empty">
      {matcher.active && shown.length < open.length
        ? "No open alerts match the current filters."
        : "No open synthetic alerts."}
    </p>
  ) : (
    <ul ref={listRef} className="ops-alert-list" data-compact={compact || undefined} aria-label="Open alerts">
      {shown.map((a) => (
        <AlertItem key={a.id} alert={a} onSelect={onSelect} mentioned={a.id === mentioned} />
      ))}
    </ul>
  );
}

function AlertItem({ alert, onSelect, mentioned }: { alert: OpsAlert; onSelect?: () => void; mentioned: boolean }) {
  const { selection, selectFlight, setAcknowledged } = useOperations();
  const flight = OPS_FLIGHTS_BY_ID.get(alert.flightId);
  const selected = !!flight && isFlightSelected(flight, selection);
  const Icon = ICONS[alert.kind];
  const itemRef = useRef<HTMLLIElement>(null);
  const textId = useId();
  // The row stays lit, its menu button showing, while the menu is open.
  const [menuOpen, setMenuOpen] = useState(false);

  // Archiving removes the row and its menu, so focus moves on to the next
  // row (or the one before), or to the window once none are left.
  const archive = () => {
    const item = itemRef.current;
    const neighbour = (item?.nextElementSibling ?? item?.previousElementSibling)?.querySelector<HTMLElement>(".ops-alert");
    (neighbour ?? item?.closest<HTMLElement>('[role="dialog"]'))?.focus();
    setAcknowledged(alert.id, true);
  };

  return (
    <li ref={itemRef} className="ops-alert-item" data-alert-id={alert.id} data-menu-open={menuOpen || undefined}>
      <button
        type="button"
        className="ops-alert"
        aria-pressed={selected}
        // The one Skye is talking about, in her short list.
        data-mentioned={mentioned || undefined}
        disabled={!flight}
        // Re-targets the details popover instead of closing it (SelectionPopover).
        data-ops-alert-flight={flight?.id}
        onClick={() => {
          if (!flight) return;
          selectFlight(flight, "alert");
          onSelect?.();
        }}
      >
        <span className="ops-alert-icon">
          <Icon />
        </span>
        <span className="ops-alert-body">
          {/* Headline and detail run on as one text, clamped to the row's 96px. */}
          <span id={textId} className="ops-alert-text">
            <span className="ops-visually-hidden">
              {alert.severity === "warning" ? "Warning: " : "Notice: "}
            </span>
            <Caption1Strong className="ops-alert-title">{alert.heading ?? alert.title}</Caption1Strong>{" "}
            <Caption1 className="ops-alert-detail">{alert.detail}</Caption1>
          </span>
          {alert.kind === "conflict" && (
            <Tag className="ops-alert-tag" size="extra-small" shape="rounded">
              Conflict
            </Tag>
          )}
        </span>
      </button>
      <Menu positioning="below-end" open={menuOpen} onOpenChange={(_, data) => setMenuOpen(data.open)}>
        <MenuTrigger disableButtonEnhancement>
          <Tooltip content="More options" relationship="label">
            <Button
              {...KEEP_SELECTION_ATTR}
              className="ops-alert-more"
              appearance="transparent"
              icon={<MoreIcon />}
              aria-describedby={textId}
            />
          </Tooltip>
        </MenuTrigger>
        <MenuPopover {...KEEP_SELECTION_ATTR}>
          <MenuList>
            <MenuItem icon={<Archive16Regular />} onClick={archive}>
              Archive
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    </li>
  );
}
