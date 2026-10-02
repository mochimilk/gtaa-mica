// Views (eye) and Filters (funnel) icon buttons for the chart header. Each
// opens a Fluent v9 Menu with labelled MenuGroups and controlled
// checkedValues: Views is a single-choice radio group, Filters are checkbox
// groups that stay open while toggling (persistOnClick). State lives in the
// operations context; matching is in opsFilters.ts.
import { Fragment } from "react";
import {
  Button,
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
  Tooltip,
  type MenuProps,
} from "@fluentui/react-components";
import { ArrowResetRegular, EyeRegular, FilterRegular } from "@fluentui/react-icons";
import { useOperations } from "./OperationsContext";
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
const MENU_POSITIONING = { autoSize: "height", overflowBoundaryPadding: 8 } as const;

const optionLabel = (dim: FilterDim, value: string) =>
  dim === "area" && value === UNASSIGNED_AREA ? "Unassigned (no stand)" : value;

export function ViewsFiltersToolbar() {
  const { view, setView, filters, setFilter, resetFilters } = useOperations();
  const viewLabel = VIEWS.find((v) => v.value === view)?.label ?? "All activity";
  const viewActive = view !== "all";
  const filterCount = DIMS.reduce((n, d) => n + filters[d].length, 0);

  const onViewChange: MenuProps["onCheckedValueChange"] = (_, data) => {
    if (data.name === "view" && data.checkedItems[0]) setView(data.checkedItems[0] as ViewKey);
  };
  const onFilterChange: MenuProps["onCheckedValueChange"] = (_, data) => {
    if ((DIMS as string[]).includes(data.name)) setFilter(data.name as FilterDim, data.checkedItems);
  };

  const viewsName = `Views: ${viewLabel}`;
  const filtersName =
    filterCount > 0 ? `Filters: ${filterCount} selected` : "Filters: none (showing all)";

  return (
    <>
      <Menu
        checkedValues={{ view: [view] }}
        onCheckedValueChange={onViewChange}
        positioning={MENU_POSITIONING}
      >
        <MenuTrigger disableButtonEnhancement>
          <Tooltip content={viewsName} relationship="label">
            <Button
              {...KEEP_SELECTION_ATTR}
              icon={<EyeRegular />}
              appearance={viewActive ? "primary" : "subtle"}
            />
          </Tooltip>
        </MenuTrigger>
        <MenuPopover className="ops-menu-popover" {...KEEP_SELECTION_ATTR}>
          <MenuList className="ops-menu-list">
            <MenuGroup>
              <MenuGroupHeader>View (whole synthetic demo window)</MenuGroupHeader>
              {VIEWS.map((v) => (
                <MenuItemRadio key={v.value} name="view" value={v.value} title={v.hint}>
                  {v.label}
                </MenuItemRadio>
              ))}
            </MenuGroup>
          </MenuList>
        </MenuPopover>
      </Menu>

      <Menu
        checkedValues={filters}
        onCheckedValueChange={onFilterChange}
        positioning={MENU_POSITIONING}
      >
        <MenuTrigger disableButtonEnhancement>
          <Tooltip content={filtersName} relationship="label">
            <Button
              {...KEEP_SELECTION_ATTR}
              icon={<FilterRegular />}
              appearance={filterCount > 0 ? "primary" : "subtle"}
            >
              {filterCount > 0 ? filterCount : undefined}
            </Button>
          </Tooltip>
        </MenuTrigger>
        <MenuPopover className="ops-menu-popover" {...KEEP_SELECTION_ATTR}>
          <MenuList className="ops-menu-list">
            {DIMS.map((dim, i) => (
              <Fragment key={dim}>
                {i > 0 && <MenuDivider />}
                <MenuGroup>
                  <MenuGroupHeader>{FILTER_LABELS[dim]} (none checked = all)</MenuGroupHeader>
                  {FILTER_OPTIONS[dim].map((value) => (
                    <MenuItemCheckbox key={value} name={dim} value={value} persistOnClick>
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
            >
              Reset filters
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    </>
  );
}
