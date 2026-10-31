// The desktop app's title bar on Windows and Linux (electron/titleBar.mjs),
// the page's colour (clear, on Mica): Back and Forward through the pages and
// the left panel's toggle at its start, then the window menus, and the
// window's own controls, which Electron draws over its end. It shows no
// title; the app shows its own. In a browser, and on macOS, there is none.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button, Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import {
  ArrowLeft16Filled,
  ArrowLeft16Regular,
  ArrowRight16Filled,
  ArrowRight16Regular,
  bundleIcon,
} from "@fluentui/react-icons";
import { APP_BAR_HEIGHT } from "../app-bar";
import "./titleBar.css";

/**
 * The desktop shell's bridge: Electron's (electron/preload.cjs), or the
 * Windows app's (desktop/Bridge/HostBridge.js).
 */
type MicaDesktop = {
  /**
   * The window's system backdrop (electron/backdrop.mjs), Mica on Windows 11,
   * which shows wherever the page leaves its background clear.
   */
  backdrop?: "mica";
  /** The window menus it has, by name (MENUS); Electron's four when not given. */
  menus?: readonly string[];
  /** Opens a window menu at a point in the page, in CSS pixels; resolves once it closes. */
  openMenu(name: string, x: number, y: number): Promise<void>;
  /**
   * Pastes the clipboard where the page's focus is, as Ctrl+V does: Electron
   * keeps the clipboard from the page (DefaultContextMenu's Paste). The
   * Windows app lets the page read it, so it has none.
   */
  paste?(): Promise<void>;
  /**
   * The Windows app: where the title bar is, in CSS pixels, its height and
   * its buttons, so the rest of it drags the window. Electron's drags by CSS.
   */
  setTitleBar?(height: number, buttons: { x: number; y: number; width: number; height: number }[]): void;
};

declare global {
  interface Window {
    micaDesktop?: MicaDesktop;
  }
}

/**
 * Whether the window draws the page's base layer itself (Mica, in the desktop
 * app on Windows 11), so the page leaves its page colour clear. preload.cjs
 * also marks <html data-backdrop> for stylesheets, the boot splash's included.
 */
export function hasDesktopBackdrop() {
  return Boolean(window.micaDesktop?.backdrop);
}

/** Whether the page draws the window's title bar: in the desktop app, on Windows and Linux. */
export function hasDesktopTitleBar() {
  return Boolean(window.micaDesktop);
}

// Back and Forward's arrows at 16px in the buttons' 20px icon box: at 20px
// they look larger than the panel toggle's icon beside them.
const BackIcon = bundleIcon(ArrowLeft16Filled, ArrowLeft16Regular);
const ForwardIcon = bundleIcon(ArrowRight16Filled, ArrowRight16Regular);

/**
 * The window menus, by the names electron/titleBar.mjs and the Windows app
 * (desktop/MainWindow.xaml.cs) open them by. Help, with Check for updates,
 * is the Windows app's only.
 */
const MENUS = [
  { name: "file", label: "File" },
  { name: "edit", label: "Edit" },
  { name: "view", label: "View" },
  { name: "window", label: "Window" },
  { name: "help", label: "Help" },
];
const ELECTRON_MENUS = ["file", "edit", "view", "window"];

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
  // On Mica, the window's backdrop, as the window controls are (titleBar.mjs).
  clear: { backgroundColor: "transparent" },
  // Back, Forward and the panel toggle, set a little apart from the menus.
  nav: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXXS,
    marginRight: tokens.spacingHorizontalS,
  },
  menu: { minWidth: 0 },
  open: { backgroundColor: tokens.colorSubtleBackgroundPressed },
});

export type DesktopTitleBarProps = {
  /** Back to the page before; Back is disabled without it. */
  onBack?: () => void;
  /** On to the page gone back from; Forward is disabled without it. */
  onForward?: () => void;
  /** Right of Forward, before the menus: the left panel's toggle. */
  actions?: ReactNode;
};

/** The title bar, in the desktop app only. */
export function DesktopTitleBar(props: DesktopTitleBarProps) {
  const desktop = window.micaDesktop;
  return desktop ? <TitleBar desktop={desktop} {...props} /> : null;
}

function TitleBar({ desktop, onBack, onForward, actions }: DesktopTitleBarProps & { desktop: MicaDesktop }) {
  const styles = useStyles();
  // The menu that is open, whose button stays pressed until it closes.
  const [open, setOpen] = useState<string | null>(null);
  const openMenu = (name: string, button: HTMLElement) => {
    const { left, bottom } = button.getBoundingClientRect();
    setOpen(name);
    void desktop.openMenu(name, left, bottom).finally(() => setOpen(null));
  };
  const menus = MENUS.filter(({ name }) => (desktop.menus ?? ELECTRON_MENUS).includes(name));
  const bar = useTitleBarRegions(desktop);
  return (
    <div ref={bar} className={mergeClasses("mica-title-bar", styles.root, desktop.backdrop && styles.clear)}>
      <div className={styles.nav}>
        <Tooltip content="Back" relationship="label" positioning="below">
          <Button appearance="subtle" size="small" icon={<BackIcon />} disabled={!onBack} onClick={onBack} />
        </Tooltip>
        <Tooltip content="Forward" relationship="label" positioning="below">
          <Button appearance="subtle" size="small" icon={<ForwardIcon />} disabled={!onForward} onClick={onForward} />
        </Tooltip>
        {actions}
      </div>
      {menus.map(({ name, label }) => (
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

/**
 * Tells the Windows app where the title bar and its buttons are (setTitleBar)
 * as they move, so the rest of the bar drags the window and its buttons stay
 * clickable. Electron drags by CSS, so it's never told.
 */
function useTitleBarRegions(desktop: MicaDesktop) {
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = bar.current;
    const setTitleBar = desktop.setTitleBar;
    if (!element || !setTitleBar) return undefined;
    const report = () =>
      setTitleBar(
        element.offsetHeight,
        [...element.querySelectorAll("button")].map((button) => {
          const { x, y, width, height } = button.getBoundingClientRect();
          return { x, y, width, height };
        }),
      );
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  });
  return bar;
}
