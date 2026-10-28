// The decision on Skye's changes waiting to be approved (skyeReview), at the
// foot of the Outputs panel and of its peek: the primary button, full width,
// over Undo, which puts them back and clears every selection. Approving clears
// what Skye has selected. When the
// changes move bags, the primary button first calls in baggage (Review with
// baggage), waits while they ring or look, and approves once they have.
// Nothing shows while Skye is still at work, nor once nothing waits.
import { useSyncExternalStore } from "react";
import { Button, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { callGuests, subscribeCallGuests } from "../live/callGuests";
import { useOpsActions } from "./OperationsContext";
import { useOutputs } from "./OutputSteps";
import { callForSignoffs, skyeReview, subscribeSkyeReview, type Signoff } from "./skyeReview";
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
});

/** Where a teammate's sign-off has got to, for screen readers; `ringing` while they are being called. */
function signoffText(signoff: Signoff, ringing: boolean): string {
  switch (signoff.state) {
    case "needed":
      return ringing ? `Calling ${signoff.name}` : `Needs ${signoff.expertise} operator’s approval`;
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
  const primary =
    waiting?.state === "needed" && !ringing.includes(waiting.name)
      ? { label: `Review with ${waiting.expertise}`, onClick: callForSignoffs, disabled: false }
      : waiting
        ? { label: `Waiting on ${waiting.expertise}`, onClick: undefined, disabled: true }
        : { label: "Approve", onClick: approveSkyeChanges, disabled: false };

  return (
    <div className={mergeClasses(styles.root, className)}>
      <Button
        appearance="primary"
        className={styles.button}
        disabledFocusable={primary.disabled}
        onClick={primary.onClick}
      >
        {primary.label}
      </Button>
      <Button appearance="transparent" className={styles.button} onClick={undoSkyeChanges}>
        Undo
      </Button>
      <p className="ops-visually-hidden" aria-live="polite">
        {waiting
          ? signoffText(waiting, ringing.includes(waiting.name))
          : review.signoffs.length > 0
            ? `Approved by ${review.signoffs.map((entry) => entry.name).join(" and ")}. Ready for your approval.`
            : "Ready for your approval."}
      </p>
    </div>
  );
}
