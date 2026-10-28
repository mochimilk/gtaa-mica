// The desktop app's title bar on Windows and Linux (electron/titleBar.mjs),
// the page's colour: the window menus at its start, and the window's own
// controls, which Electron draws over its end. It shows no title; the app
// shows its own. In a browser, and on macOS, there is none.
import { useState } from "react";
import { Button, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { APP_BAR_HEIGHT } from "../app-bar";
import "./titleBar.css";

/** The desktop shell's bridge (electron/preload.cjs). */
type MicaDesktop = {
  /** Opens a window menu at a point in the page, in CSS pixels; resolves once it closes. */
  openMenu(name: string, x: number, y: number): Promise<void>;
};

declare global {
  interface Window {
    micaDesktop?: MicaDesktop;
  }
}

/** The window menus, by the names electron/titleBar.mjs opens them by. */
const MENUS = [
  { name: "file", label: "File" },
  { name: "edit", label: "Edit" },
  { name: "view", label: "View" },
  { name: "window", label: "Window" },
];

/*
 * The app bar's height and 16px side padding, as tall as the window controls
 * (TITLE_BAR_HEIGHT, which Electron reports as titlebar-area-height), with no
 * vertical padding, so Fluent's small subtle buttons center in it.
 */
const useStyles = makeStyles({
  root: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    height: `env(titlebar-area-height, ${APP_BAR_HEIGHT}px)`,
    padding: "0 16px",
    boxSizing: "border-box",
    backgroundColor: tokens.colorNeutralBackground5,
  },
  menu: { minWidth: 0 },
  open: { backgroundColor: tokens.colorSubtleBackgroundPressed },
});

/** The title bar, in the desktop app only. */
export function DesktopTitleBar() {
  const desktop = window.micaDesktop;
  return desktop ? <TitleBar desktop={desktop} /> : null;
}

function TitleBar({ desktop }: { desktop: MicaDesktop }) {
  const styles = useStyles();
  // The menu that is open, whose button stays pressed until it closes.
  const [open, setOpen] = useState<string | null>(null);
  const openMenu = (name: string, button: HTMLElement) => {
    const { left, bottom } = button.getBoundingClientRect();
    setOpen(name);
    void desktop.openMenu(name, left, bottom).finally(() => setOpen(null));
  };
  return (
    <div className={mergeClasses("mica-title-bar", styles.root)}>
      {MENUS.map(({ name, label }) => (
        <Button
          key={name}
          appearance="subtle"
          size="small"
          aria-haspopup="menu"
          aria-expanded={open === name}
          className={mergeClasses(styles.menu, open === name && styles.open)}
          // Leaves focus where it was, so Edit's commands act on it.
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => openMenu(name, event.currentTarget)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
