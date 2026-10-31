import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { Panel } from "@coral-ai/react";

/** The width each page's left panel opens at: the last one's, as the user left it. */
let sharedWidth = 320;

export type SharedPanelLeftProps = Omit<ComponentProps<typeof Panel.Left>, "panelWidth">;

/**
 * Coral's Panel.Left at one width across the nav rail's pages: widen it on one
 * page and the others open at that width too. Coral's event bus does this for
 * Panel.Right (panelWidthChanged), but Panel.Left keeps its width to itself, so
 * this reads it off the panel's style, where Coral sets it as the panel is
 * dragged (0px while it opens or closes), and opens the next panel at it.
 */
export function SharedPanelLeft(props: SharedPanelLeftProps) {
  const [width] = useState(() => sharedWidth);
  const hostRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new MutationObserver(() => {
      const panel = host.firstElementChild as HTMLElement | null;
      const dragged = parseFloat(panel?.style.width ?? "");
      if (dragged > 0) sharedWidth = dragged;
    });
    observer.observe(host, { subtree: true, attributeFilter: ["style"] });
    return () => observer.disconnect();
  }, []);
  // Display contents: the panel stays a flex child of the page's row.
  return (
    <div ref={hostRef} style={{ display: "contents" }}>
      <Panel.Left {...props} panelWidth={width} />
    </div>
  );
}
