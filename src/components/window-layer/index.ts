// What stands over Skye's cursors. Her cursors and their tethers
// (agent-cursor.css, 2147483000) sit over everything else, Fluent's menus and
// tooltips (its portals, 1000000) included, so she is seen clicking through
// them. Over her cursors stand the Outputs peek and Ask Skye's open windows
// (the chat, the alerts): WINDOW_Z. Fluent's portals opened from inside them
// (a tooltip, a menu) mount over them in turn, in windowPortalNode
// (PortalMountNodeProvider), at WINDOW_PORTAL_Z.
export const WINDOW_Z = 2147483001;
export const WINDOW_PORTAL_Z = 2147483002;

/**
 * A layer at the top of the page at `z`, made once: fixed, and no height of
 * its own, so it takes no clicks; what is put in it places itself.
 */
function layer(name: string, z: number): () => HTMLElement {
  let node: HTMLElement | null = null;
  return () => {
    if (!node || !node.isConnected) {
      node = document.createElement("div");
      node.setAttribute(`data-${name}`, "");
      node.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:${z}`;
      document.body.append(node);
    }
    return node;
  };
}

/** Where the Outputs peek mounts (through a Fluent Portal, so it keeps the theme). */
export const windowNode = layer("window-layer", WINDOW_Z);
/** Where Fluent's portals opened from those windows mount, over them. */
export const windowPortalNode = layer("window-portals", WINDOW_PORTAL_Z);
