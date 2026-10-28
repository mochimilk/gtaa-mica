// Views (eye) and Filters (funnel) icon buttons for the chart header. Each
// opens a menu (components/menu) with MenuGroups and controlled checkedValues: Views
// is a single-choice radio group, with the board's zoom under it (given
// `zoom`); the board's look (Skye glow, Timeline, Noise) is in Settings
// (components/settings). Filters are labelled checkbox groups that stay open
// while toggling (persistOnClick). State lives in the operations context;
// matching is in opsFilters.ts. The data-ops-* attributes are how Skye's
// cursor finds these controls (agentGestures.ts).
import { Fragment, useState } from "react";
import { Button, Tooltip } from "@fluentui/react-components";
import { ArrowResetRegular, EyeRegular, FilterRegular } from "@fluentui/react-icons";
import { isSkyeEvent } from "../components/agent-cursor";
import {
  Menu,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuItemCheckbox,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  type MenuProps,
} from "../components/menu";
import type { TimelineZoom } from "../stand-timeline";
import { ZoomMenuRow } from "../stand-timeline-demo/ZoomMenuRow";
import { useOpsActions, useOpsBoard } from "./OperationsContext";
import {
  FILTER_LABELS,
  FILTER_OPTIONS,
  UNASSIGNED_AREA,
  VIEWS,
  type FilterDim,
  type ViewKey,
} from "./opsFilters";
import "./operations.css";

/**
 * Marks toolbar buttons and menus: clicking them while selection details are
 * open closes the details popover but keeps the selection (SelectionPopover).
 */
export const KEEP_SELECTION_ATTR = { "data-ops-keep-selection": "" };

const DIMS: FilterDim[] = ["carrier", "area", "type"];

/**
 * Fit the menus to the space actually available from their anchor: Fluent's
 * autoSize sets the popover root's max-height to the room left in the
 * viewport (minus the padding). The 480px cap and the scrolling live on the
 * MenuList inside (operations.css), which shrinks with the root.
 */
export const MENU_POSITIONING = { autoSize: "height", overflowBoundaryPadding: 8 } as const;

const optionLabel = (dim: FilterDim, value: string) =>
  dim === "area" && value === UNASSIGNED_AREA ? "Unassigned (no stand)" : value;

export function ViewsFiltersToolbar({ zoom }: { zoom?: TimelineZoom }) {
  const { view, filters } = useOpsBoard();
  const { setView, setFilter, resetFilters } = useOpsActions();
  const viewLabel = VIEWS.find((v) => v.value === view)?.label ?? "All activity";
  const viewActive = view !== "all";
  const filterCount = DIMS.reduce((n, d) => n + filters[d].length, 0);

  const onViewChange: MenuProps["onCheckedValueChange"] = (_, data) => {
    if (data.name === "view" && data.checkedItems[0]) setView(data.checkedItems[0] as ViewKey);
  };
  const onFilterChange: MenuProps["onCheckedValueChange"] = (_, data) => {
    if ((DIMS as string[]).includes(data.name)) setFilter(data.name as FilterDim, data.checkedItems);
  };

  const filtersMenu = useSharedMenu();
  const viewsMenu = useSharedMenu();

  const viewsName = `Views: ${viewLabel}`;
  const filtersName =
    filterCount > 0 ? `Filters: ${filterCount} selected` : "Filters: none (showing all)";

  return (
    <>
      <Menu
        open={viewsMenu.open}
        onOpenChange={viewsMenu.onOpenChange}
        checkedValues={{ view: [view] }}
        onCheckedValueChange={onViewChange}
        positioning={MENU_POSITIONING}
      >
        <MenuTrigger disableButtonEnhancement>
          <Tooltip content={viewsName} relationship="label">
            <Button
              {...KEEP_SELECTION_ATTR}
              data-ops-menu="views"
              icon={<EyeRegular />}
              appearance={viewActive ? "primary" : "subtle"}
            />
          </Tooltip>
        </MenuTrigger>
        <MenuPopover className="ops-menu-popover" data-opened-by={viewsMenu.openedBy} {...KEEP_SELECTION_ATTR}>
          <MenuList className="ops-menu-list">
            <MenuGroup aria-label="View">
              {VIEWS.map((v) => (
                <MenuItemRadio key={v.value} name="view" value={v.value} title={v.hint} data-ops-view={v.value}>
                  {v.label}
                </MenuItemRadio>
              ))}
            </MenuGroup>
            {zoom && (
              <>
                <MenuDivider />
                <ZoomMenuRow zoom={zoom} />
              </>
            )}
          </MenuList>
        </MenuPopover>
      </Menu>

      <Menu
        open={filtersMenu.open}
        onOpenChange={filtersMenu.onOpenChange}
        checkedValues={filters}
        onCheckedValueChange={onFilterChange}
        positioning={MENU_POSITIONING}
      >
        <MenuTrigger disableButtonEnhancement>
          <Tooltip content={filtersName} relationship="label">
            <Button
              {...KEEP_SELECTION_ATTR}
              data-ops-menu="filters"
              icon={<FilterRegular />}
              appearance={filterCount > 0 ? "primary" : "subtle"}
            >
              {filterCount > 0 ? filterCount : undefined}
            </Button>
          </Tooltip>
        </MenuTrigger>
        <MenuPopover className="ops-menu-popover" data-opened-by={filtersMenu.openedBy} {...KEEP_SELECTION_ATTR}>
          <MenuList className="ops-menu-list">
            {DIMS.map((dim, i) => (
              <Fragment key={dim}>
                {i > 0 && <MenuDivider />}
                <MenuGroup>
                  <MenuGroupHeader>{FILTER_LABELS[dim]} (none checked = all)</MenuGroupHeader>
                  {FILTER_OPTIONS[dim].map((value) => (
                    <MenuItemCheckbox
                      key={value}
                      name={dim}
                      value={value}
                      persistOnClick
                      data-ops-filter-dim={dim}
                      data-ops-filter-value={value}
                    >
                      {optionLabel(dim, value)}
                    </MenuItemCheckbox>
                  ))}
                </MenuGroup>
              </Fragment>
            ))}
            <MenuDivider />
            <MenuItem
              icon={<ArrowResetRegular />}
              disabled={filterCount === 0}
              onClick={resetFilters}
              data-ops-filter-reset=""
            >
              Reset filters
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    </>
  );
}

/**
 * A menu's open state, for two at the board: the user and Skye. One the user
 * opened stays open through Skye's clicks elsewhere (her cursors' events,
 * see isSkyeEvent); one Skye opened closes as any menu does. Who opened it is
 * marked on its popover (data-opened-by), so Skye's cursor can leave the
 * user's menus alone (agentGestures.ts).
 */
function useSharedMenu() {
  const [open, setOpen] = useState(false);
  const [openedBy, setOpenedBy] = useState<"user" | "skye">("user");
  const onOpenChange: MenuProps["onOpenChange"] = (_, data) => {
    if (data.open) {
      setOpenedBy(isSkyeEvent() ? "skye" : "user");
      setOpen(true);
      return;
    }
    if (openedBy === "user" && isSkyeEvent()) return;
    setOpen(false);
  };
  return { open, onOpenChange, openedBy };
}
