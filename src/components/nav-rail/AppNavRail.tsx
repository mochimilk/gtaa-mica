import type { ReactNode } from "react";
import { Airplane } from "@coral-ai/bundleicons/Airplane";
import { Branch } from "@coral-ai/bundleicons/Branch";
import { MoreHorizontal } from "@coral-ai/bundleicons/MoreHorizontal";
import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from "../menu";
import { AccountButton } from "./AccountButton";
import { NavRail, NavRailButton } from "./NavRail";

export type AppNavRailProps = {
  /** Above the account at the rail's foot: e.g. the left panel's toggle. */
  actionsEnd?: ReactNode;
};

/**
 * Mica's pages and the user, down the shell's left edge. The stand planner is
 * the page on screen. The other entries are visual only for now: nothing
 * listens to them.
 */
export function AppNavRail({ actionsEnd }: AppNavRailProps) {
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
      <NavRailButton icon={Airplane} label="Stand planner" current />
      <NavRailButton icon={Branch} label="Scenarios" />
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
