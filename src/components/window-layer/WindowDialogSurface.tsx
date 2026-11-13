import { DialogSurface, PortalMountNodeProvider, type DialogSurfaceProps } from "@fluentui/react-components";
import { windowNode, windowPortalNode } from "./index";

export function WindowDialogSurface({ children, ...props }: DialogSurfaceProps) {
  return (
    <PortalMountNodeProvider value={windowNode()}>
      <DialogSurface {...props}>
        <PortalMountNodeProvider value={windowPortalNode()}>{children}</PortalMountNodeProvider>
      </DialogSurface>
    </PortalMountNodeProvider>
  );
}
