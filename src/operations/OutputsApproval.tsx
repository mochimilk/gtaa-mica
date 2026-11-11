// The decision on Skye's changes waiting to be approved (skyeReview), under
// the request waiting in the Outputs panel and at the foot of its peek: where
// it stands, with who approved it and when once they have; then the primary
// button, full width, over Cancel, which puts them back and clears every
// selection. Approving clears what Skye has selected. When the changes move
// bags, the primary button first calls in baggage (Review with baggage: Skye
// places the call on the Chat page, placeSignoffCall), waits while they ring or
// look, and approves only once they have.
// Nothing shows while Skye is still at work, nor once nothing waits.
import { useSyncExternalStore } from "react";
import { Button, Caption1, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { callGuests, subscribeCallGuests } from "../live/callGuests";
import { placeSignoffCall } from "./agentGestures";
import { useOpsActions } from "./OperationsContext";
import { useOutputs } from "./OutputSteps";
import { formatLogTime } from "./outputs";
import { placingSignoffCall, skyeReview, subscribeSkyeReview, type Signoff } from "./skyeReview";
import "./operations.css";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  button: {
    width: "100%",
  },
  status: {
    paddingTop: tokens.spacingVerticalXS,
    color: tokens.colorNeutralForeground2,
  },
});

/** Where a teammate's sign-off has got to; `ringing` while they are being called. */
function signoffText(signoff: Signoff, ringing: boolean): string {
  switch (signoff.state) {
    case "needed":
      return ringing ? `Calling ${signoff.name}` : `Pending review by ${signoff.expertise}`;
    case "asked":
      return `${signoff.name} is reviewing`;
    case "approved":
      return `Approved by ${signoff.name}`;
  }
}

export function OutputsApproval({ className }: { className?: string }) {
  const styles = useStyles();
  const review = useSyncExternalStore(subscribeSkyeReview, skyeReview);
  const ringing = useSyncExternalStore(subscribeCallGuests, callGuests)?.calling ?? [];
  const working = useOutputs().some((request) => request.actor === "skye" && request.working);
  const { undoSkyeChanges, approveSkyeChanges } = useOpsActions();
  if (!review || working) return null;

  const waiting = review.signoffs.find((entry) => entry.state !== "approved");
  const primary = placingSignoffCall()
    ? { label: `Calling ${waiting?.expertise ?? ""}`, onClick: undefined, disabled: true }
    : waiting?.state === "needed" && !ringing.includes(waiting.name)
      ? { label: `Review with ${waiting.expertise}`, onClick: placeSignoffCall, disabled: false }
      : waiting
        ? { label: `Waiting on ${waiting.expertise}`, onClick: undefined, disabled: true }
        : { label: "Approve", onClick: approveSkyeChanges, disabled: false };
  const approvers = review.signoffs.map((entry) => `${entry.name}${entry.at ? ` · ${formatLogTime(entry.at)}` : ""}`).join(" and ");

  return (
    <div className={mergeClasses(styles.root, className)}>
      {/* Said as well as shown, as it changes. */}
      <Caption1 as="p" className={styles.status} aria-live="polite" style={{ margin: 0 }}>
        {waiting
          ? signoffText(waiting, ringing.includes(waiting.name))
          : review.signoffs.length > 0
            ? `Approved by ${approvers}. Ready for your approval.`
            : "Ready for your approval."}
      </Caption1>
      <Button
        appearance="primary"
        className={styles.button}
        disabledFocusable={primary.disabled}
        onClick={primary.onClick}
        data-outputs-decision=""
      >
        {primary.label}
      </Button>
      <Button appearance="transparent" className={styles.button} onClick={undoSkyeChanges}>
        Cancel
      </Button>
    </div>
  );
}
