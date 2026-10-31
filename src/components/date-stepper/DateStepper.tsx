import { Button, makeStyles, mergeClasses, tokens, Tooltip } from "@fluentui/react-components";
import { ChevronLeft16Regular, ChevronRight16Regular } from "@fluentui/react-icons";

/*
 * One 28px bordered box in three cells: the previous-day paddle, the date and
 * the next-day paddle, split by hairlines. The paddles are 28px squares flush
 * in the box, so their hover fills it edge to edge. The outer border is drawn
 * over them (::after) rather than around them, so it takes no room from the
 * 28px.
 */
const useStyles = makeStyles({
  root: {
    position: "relative",
    display: "flex",
    alignItems: "stretch",
    width: "fit-content",
    height: "28px",
    borderRadius: tokens.borderRadiusMedium,
    overflow: "hidden",
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
      borderRadius: "inherit",
      pointerEvents: "none",
    },
  },
  step: {
    width: "28px",
    minWidth: "28px",
    height: "28px",
    padding: 0,
    borderRadius: 0,
  },
  icon: {
    width: "16px",
    height: "16px",
    fontSize: "16px",
  },
  date: {
    display: "flex",
    alignItems: "center",
    padding: `0 ${tokens.spacingHorizontalXL}`,
    borderLeft: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRight: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground2,
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightRegular,
    lineHeight: tokens.lineHeightBase300,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-14" → "2026 Nov 14". */
export function formatStepperDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${year} ${MONTHS[month - 1]} ${day}`;
}

export type DateStepperProps = {
  /** The day shown, as YYYY-MM-DD. */
  date: string;
  /** Steps a day back. Without it the button shows, disabled. */
  onPrevious?: () => void;
  /** Steps a day on. Without it the button shows, disabled. */
  onNext?: () => void;
  className?: string;
};

/** A day with buttons either side to step to the day before or after. */
export function DateStepper({ date, onPrevious, onNext, className }: DateStepperProps) {
  const styles = useStyles();
  return (
    <div role="group" aria-label="Date" className={mergeClasses(styles.root, className)}>
      <Tooltip content="Previous day" relationship="label">
        <Button
          appearance="subtle"
          className={styles.step}
          icon={{ className: styles.icon, children: <ChevronLeft16Regular /> }}
          disabledFocusable={!onPrevious}
          onClick={onPrevious}
        />
      </Tooltip>
      <time dateTime={date} className={styles.date}>
        {formatStepperDate(date)}
      </time>
      <Tooltip content="Next day" relationship="label">
        <Button
          appearance="subtle"
          className={styles.step}
          icon={{ className: styles.icon, children: <ChevronRight16Regular /> }}
          disabledFocusable={!onNext}
          onClick={onNext}
        />
      </Tooltip>
    </div>
  );
}
