// Asks before the user's swap (a drop, the Swap button), in a popover beside
// the two stays (never over either; see linkAnchor), which stay in view,
// selected and linked, while the user decides. The swap is made only on
// Approve; see OperationsContext's requestSwap. Skye's swaps are approved once
// made instead, with her other changes (OutputsApproval).
import { useLayoutEffect, useRef, useState } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import { ConfirmPopover, type ConfirmPopoverTarget } from "../components/confirm-popover";
import { formatUtcWithDay } from "../stand-timeline-demo/demoData";
import { occupancyById, stayName } from "./allocation";
import { useBesidePlacement } from "./linkAnchor";
import { useOpsActions, useOpsDetails } from "./OperationsContext";
import { revealRect } from "./SelectionPopover";

const useStyles = makeStyles({
  text: {
    margin: 0,
  },
  list: {
    margin: 0,
    paddingLeft: tokens.spacingHorizontalL,
  },
  note: {
    margin: 0,
    color: tokens.colorNeutralForeground3,
  },
});

const barOf = (occupancyId: string) =>
  document.querySelector(`[data-occupancy-id="${CSS.escape(occupancyId)}"]`);

export function SwapConfirm() {
  const { swapRequest } = useOpsDetails();
  const { answerSwap } = useOpsActions();
  const styles = useStyles();
  const [ready, setReady] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pair = swapRequest ? [swapRequest.occupancyId, swapRequest.otherId] : null;
  // By the line between the two, never over either (see useBesidePlacement).
  const beside = useBesidePlacement(pair, ready, surfaceRef);
  const target: ConfirmPopoverTarget | null = ready ? (beside?.target ?? null) : null;

  // Brings the two bars into view and puts the question beside them.
  useLayoutEffect(() => {
    if (!swapRequest) {
      setReady(false);
      return;
    }
    const bars = [barOf(swapRequest.occupancyId), barOf(swapRequest.otherId)].filter(
      (bar): bar is Element => bar !== null,
    );
    const region = bars[0]?.closest<HTMLElement>(".st-scroller");
    if (region && bars.length === 2) {
      const [a, b] = bars.map((bar) => bar.getBoundingClientRect());
      const left = Math.min(a.left, b.left);
      const top = Math.min(a.top, b.top);
      revealRect(region, new DOMRect(left, top, Math.max(a.right, b.right) - left, Math.max(a.bottom, b.bottom) - top));
    }
    setReady(bars.length === 2);
  }, [swapRequest]);

  const a = swapRequest ? occupancyById(swapRequest.occupancyId) : undefined;
  const b = swapRequest ? occupancyById(swapRequest.otherId) : undefined;
  if (!swapRequest || !a || !b) return null;
  const line = (stay: typeof a, to: string) =>
    `${stayName(stay)}, ${formatUtcWithDay(stay.start)}–${formatUtcWithDay(stay.end)}: ${stay.rowId} → ${to}`;

  return (
    <ConfirmPopover
      open={target !== null}
      target={target}
      placement={beside ?? undefined}
      surfaceRef={surfaceRef}
      title="Swap these stays?"
      onApprove={() => answerSwap(true)}
      onCancel={() => answerSwap(false)}
    >
      <p className={styles.text}>Are you sure you want to swap them? Each keeps its times and takes the other's stand:</p>
      <ul className={styles.list}>
        <li>{line(a, b.rowId)}</li>
        <li>{line(b, a.rowId)}</li>
      </ul>
      <p className={styles.note}>A demo change, checked only for overlaps and the sample stand sizes.</p>
    </ConfirmPopover>
  );
}
