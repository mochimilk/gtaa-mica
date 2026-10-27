// The pieces changed for a request, one row each, as the Outputs panel and its
// peek under the board's header both list them: Ask Skye's step spinner for
// where the piece stands, the stay (or area) and what happened to it, and at
// the row's end who has to approve it, or who did. Rows are one fixed height,
// so the peek can show five and a half. In the panel each is a Panel.NavItem,
// as the requests over them are groups, that takes the user to the piece on
// the board (`onOpen`).
import { useSyncExternalStore, type ReactNode } from "react";
import { Panel } from "@coral-ai/react";
import { Avatar, Badge, Body1, makeStyles, mergeClasses, tokens, Tooltip } from "@fluentui/react-components";
import { ArrowUndo20Regular } from "@fluentui/react-icons";
import { StepStatusIcon, type TaskStepStatus } from "../components/step-status-icon";
import { describeRequest, outputs, subscribeOutputs, type OutputRequest, type OutputStatus, type OutputStep } from "./outputs";

export const useOutputs = () => useSyncExternalStore(subscribeOutputs, outputs);

/** Each row's height, px, its contents centred in it. */
export const OUTPUT_ROW_HEIGHT = 40;

/** Between a row's 32px icon box and its text; an icon heading the rows (OutputsPanel's avatars) keeps it too, to line up. */
export const OUTPUT_ICON_GAP = tokens.spacingHorizontalXS;

const STATUS_LABEL: Record<OutputStatus, string> = {
  working: "Skye is on it",
  "pending-approval": "waiting for a teammate's approval",
  waiting: "waiting for your approval",
  done: "done",
  undone: "undone",
};

/**
 * The spinner's state for each piece's: the dots while Skye has hold of it,
 * Fluent's Spinner only while a teammate still has to approve it, and the
 * check once Skye's part is done; an undone one has its own icon, boxed the same.
 */
const STEP_STATUS: Record<Exclude<OutputStatus, "undone">, TaskStepStatus> = {
  working: "in-progress",
  "pending-approval": "pending-approval",
  waiting: "done",
  done: "done",
};

const useStyles = makeStyles({
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
  },
  // A piece Skye has just taken hold of fades in at the top, rather than pushing the rest down in one jump.
  item: {
    animationName: { from: { opacity: 0 }, to: { opacity: 1 } },
    animationDuration: tokens.durationNormal,
    animationTimingFunction: tokens.curveDecelerateMid,
    "@media (prefers-reduced-motion: reduce)": { animationName: "none" },
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: OUTPUT_ICON_GAP,
    boxSizing: "border-box",
  },
  // Panel.NavItem, as the group's header over it: its full width, its content
  // 8px in (its 1px border, then 7px), and the row's gap and text, not its own.
  navItem: {
    margin: 0,
    width: "100%",
    paddingLeft: "7px",
    paddingRight: "7px",
    "& > span": { columnGap: OUTPUT_ICON_GAP },
    "& > span > span:nth-child(2) > :first-child": { marginBottom: 0 },
  },
  iconSlot: { display: "flex", flexShrink: 0 },
  // The undone icon, boxed as the status icon is (StepStatusIcon).
  iconBox: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "32px",
    height: "32px",
    flexShrink: 0,
    color: tokens.colorNeutralForeground1,
  },
  text: {
    display: "flex",
    gap: OUTPUT_ICON_GAP,
    minWidth: 0,
  },
  title: {
    flexShrink: 0,
    whiteSpace: "nowrap",
    color: tokens.colorNeutralForeground1,
  },
  // 8px from the title, with the 4px gap.
  detail: {
    paddingLeft: tokens.spacingHorizontalXS,
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: tokens.colorNeutralForeground3,
  },
  undone: {
    color: tokens.colorNeutralForeground3,
  },
  // A request waiting for approval says so in Fluent's warning colour.
  waiting: {
    color: tokens.colorStatusWarningForeground1,
  },
  // Who has to approve it, or who has, at the row's end.
  trailing: {
    flexShrink: 0,
    marginLeft: "auto",
  },
  // Said, not shown: the icon shows it.
  status: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
});

export type OutputStepsProps = {
  steps: readonly OutputStep[];
  className?: string;
  rowClassName?: string;
  /** Makes each row a Panel.NavItem that takes the user to the piece on the board. */
  onOpen?: (step: OutputStep) => void;
  /** The stays selected on the board: their rows show selected. */
  selectedStayIds?: readonly string[];
};

export function OutputSteps({
  steps,
  className,
  rowClassName,
  onOpen,
  selectedStayIds,
}: OutputStepsProps) {
  const styles = useStyles();
  return (
    <ul className={mergeClasses(styles.list, className)}>
      {steps.map((step) => {
        const icon = <PieceIcon status={step.status} />;
        const text = (
          <>
            <Body1 className={mergeClasses(styles.title, step.status === "undone" && styles.undone)}>{step.title}</Body1>
            <Body1 className={styles.detail}>{step.detail}</Body1>
            <span className={styles.status}>, {STATUS_LABEL[step.status]}</span>
          </>
        );
        const trailing = trailingOf(step, styles.trailing);
        return (
          <li key={step.id} className={mergeClasses(styles.item, !onOpen && styles.row, !onOpen && rowClassName)} style={onOpen ? undefined : { height: OUTPUT_ROW_HEIGHT }}>
            {onOpen ? (
              <Panel.NavItem
                className={mergeClasses(styles.navItem, rowClassName)}
                style={{ height: OUTPUT_ROW_HEIGHT }}
                icon={icon}
                label={<span className={styles.text}>{text}</span>}
                actions={trailing}
                selected={!!step.stayId && !!selectedStayIds?.includes(step.stayId)}
                onClick={() => onOpen(step)}
              />
            ) : (
              <>
                {icon}
                {text}
                {trailing}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Where a request stands, for its header: "Waiting for approval · 2 changes", the status in warning colour while it waits. */
export function RequestMeta({ request }: { request: OutputRequest }) {
  const styles = useStyles();
  const { status, count, waiting } = describeRequest(request);
  return (
    <>
      {status && <span className={waiting ? styles.waiting : undefined}>{status}</span>}
      {status && count && " · "}
      {count}
    </>
  );
}

/**
 * Where a piece stands, in its 32px box. `filled` is what Panel.NavItem gives
 * its icon on hover; these have no filled form.
 */
function PieceIcon({ status }: { status: OutputStatus; filled?: boolean }) {
  const styles = useStyles();
  if (status === "undone") {
    return (
      <span className={styles.iconBox} aria-hidden>
        <ArrowUndo20Regular />
      </span>
    );
  }
  return (
    <span className={styles.iconSlot} aria-hidden>
      <StepStatusIcon status={STEP_STATUS[status]} />
    </span>
  );
}

/** Who has to approve a piece before the user, while they still have to; or who did. */
function trailingOf(step: OutputStep, className: string): ReactNode {
  if (step.approvedBy) {
    return (
      <Tooltip content={`Approved by ${step.approvedBy}`} relationship="label">
        <Avatar size={16} name={step.approvedBy} color="colorful" className={className} />
      </Tooltip>
    );
  }
  if (!step.needs || (step.status !== "working" && step.status !== "pending-approval")) return null;
  return (
    <Tooltip content={`Needs ${step.needs.name}’s approval`} relationship="label">
      <Badge appearance="tint" color="warning" shape="rounded" className={className}>
        {step.needs.expertise[0].toUpperCase() + step.needs.expertise.slice(1)}
      </Badge>
    </Tooltip>
  );
}
