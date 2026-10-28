import type { ReactNode } from "react";
import { Airplane } from "@coral-ai/bundleicons/Airplane";
import { Branch } from "@coral-ai/bundleicons/Branch";
import { MoreHorizontal } from "@coral-ai/bundleicons/MoreHorizontal";
import { PaintBrush } from "@coral-ai/bundleicons/PaintBrush";
import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from "../menu";
import { AccountButton } from "./AccountButton";
import { NavRail, NavRailButton } from "./NavRail";

/** The pages the rail opens: the stand planner, and the Studio's drawings for its aircraft. */
export type AppPage = "planner" | "studio";

export type AppNavRailProps = {
  /** The page on screen. */
  page: AppPage;
  onNavigate: (page: AppPage) => void;
  /** Above the account at the rail's foot: e.g. the left panel's toggle. */
  actionsEnd?: ReactNode;
};

/**
 * Mica's pages and the user, down the shell's left edge. Stand planner and
 * Studio switch the page on screen. The other entries are visual only for
 * now: nothing listens to them.
 */
export function AppNavRail({ page, onNavigate, actionsEnd }: AppNavRailProps) {
  return (
    <NavRail
      aria-label="App"
      actionsEnd={
        <>
          {actionsEnd}
          <AccountButton />
        </>
      }
    >
      <NavRailButton
        icon={Airplane}
        label="Stand planner"
        current={page === "planner"}
        onClick={() => onNavigate("planner")}
      />
      <NavRailButton icon={Branch} label="Scenarios" />
      <NavRailButton icon={PaintBrush} label="Studio" current={page === "studio"} onClick={() => onNavigate("studio")} />
      <Menu positioning="after-top">
        <MenuTrigger disableButtonEnhancement>
          <NavRailButton icon={MoreHorizontal} label="More" />
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem>3D Map</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    </NavRail>
  );
}
