import { PillTab, PillTabList } from "@coral-ai/react";

/** Stand plan / 3D Map switch in the navbar center. Visual only for now: nothing listens to it. */
export function ViewSwitcher() {
  return (
    <PillTabList defaultSelectedValue="stand-plan">
      <PillTab value="stand-plan">Stand plan</PillTab>
      <PillTab value="3d-map">3D Map</PillTab>
    </PillTabList>
  );
}
