import { DialogSurface, PortalMountNodeProvider, type DialogSurfaceProps } from "@fluentui/react-components";
import { windowNode, windowPortalNode } from "./index";

export function WindowDialogSurface({ children, ...props }: DialogSurfaceProps) {
  return (
    <DialogSurface {...props} mountNode={windowNode()}>
      <PortalMountNodeProvider value={windowPortalNode()}>{children}</PortalMountNodeProvider>
    </DialogSurface>
  );
}
