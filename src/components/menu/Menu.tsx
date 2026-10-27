// Mica's menus: Fluent's menu parts, drawn as jellyflower's tray menus
// (github.com/mochimilk/jellyflower, src/popup.cpp). menu.css restyles every
// Fluent menu in the app, Coral's included; its entrance, which Fluent plays
// from script where CSS can't reach, only comes with this Menu. Import every
// menu part from this folder, so the app's menus are one family.
import type { ReactElement } from "react";
import { Menu as FluentMenu, MenuItem, createPresenceComponent, type MenuProps } from "@fluentui/react-components";
import "./menu.css";

/**
 * jellyflower's entrance: the surface slides 32px in from its anchor's side
 * over 250ms on Microsoft's Direct Entrance curve, cubic-bezier(0, 0, 0, 1),
 * without fading. Fluent's positioning says which side, as ±1px per axis.
 * Under reduced motion, react-motion cuts it to 1ms.
 */
const MenuEntrance = createPresenceComponent({
  enter: {
    keyframes: [
      {
        transform:
          "translate(calc(var(--fui-positioning-slide-direction-x, 0px) * 32), calc(var(--fui-positioning-slide-direction-y, 0px) * 32))",
      },
      { transform: "translate(0px, 0px)" },
    ],
    duration: 250,
    easing: "cubic-bezier(0, 0, 0, 1)",
    // On top of the transform Fluent's positioning sets.
    composite: "accumulate",
  },
  // No exit: the surface goes as soon as it closes.
  exit: [],
});

/** Fluent's Menu, with jellyflower's entrance. */
export function Menu(props: MenuProps) {
  return <FluentMenu surfaceMotion={{ children: (_, motion) => <MenuEntrance {...motion} /> }} {...props} />;
}

export interface MenuToggleItemProps {
  icon: ReactElement;
  label: string;
  /** The setting's value now, shown at the row's end. */
  value: string;
  /** Moves the setting on to its next value. */
  onToggle: () => void;
}

/**
 * A setting's row, as jellyflower's: its icon and name, and its value at the
 * row's end in the secondary ink. Choosing it moves to the next value and
 * leaves the menu open, so the change shows behind it. Screen readers hear
 * "name, value".
 */
export function MenuToggleItem({ icon, label, value, onToggle }: MenuToggleItemProps) {
  return (
    <MenuItem icon={icon} secondaryContent={value} aria-label={`${label}, ${value}`} persistOnClick onClick={onToggle}>
      {label}
    </MenuItem>
  );
}
