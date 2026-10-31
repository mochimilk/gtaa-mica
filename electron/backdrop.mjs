// The window's system backdrop, kept pure so it can be tested without
// launching Electron.
//
// On Windows 11 the window's base layer is Mica, the material Microsoft's
// Fluent guidance gives a long-lived app window: the desktop wallpaper, tinted
// by the system theme, behind the title bar and wherever the page leaves its
// background clear. Windows itself falls back to a solid colour while the
// window is inactive, in battery saver, or with transparency effects off.
// main.mjs passes the backdrop to preload.cjs, which tells the page.

/**
 * The first Windows build whose windows take a system backdrop
 * (DWMWA_SYSTEMBACKDROP_TYPE): Windows 11 22H2. Electron ignores
 * backgroundMaterial on anything older.
 */
export const BACKDROP_BUILD = 22621;

/** The argument that carries the backdrop to preload.cjs, which repeats it. */
export const BACKDROP_ARGUMENT = "--mica-backdrop=";

/**
 * The window's backdrop, or undefined where the page paints its own
 * background. `setting` is MICA_DESKTOP_BACKDROP: "none" turns Mica off, so
 * the window is opaque and the page paints itself as in a browser, which is
 * cheaper to draw (Windows blends a see-through window over Mica every frame).
 * @param {NodeJS.Platform} platform process.platform
 * @param {string} release os.release(), "10.0.<build>" on Windows
 * @param {string} [setting] process.env.MICA_DESKTOP_BACKDROP
 * @returns {"mica" | undefined}
 */
export function windowBackdrop(platform, release, setting) {
  if (platform !== "win32" || setting?.trim().toLowerCase() === "none") return undefined;
  const build = Number(release.split(".")[2]);
  return build >= BACKDROP_BUILD ? "mica" : undefined;
}
