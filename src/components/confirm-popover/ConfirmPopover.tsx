import { useEffect, useRef, type ReactNode, type Ref } from "react";
import {
  Button,
  makeStyles,
  Popover,
  PopoverSurface,
  tokens,
  type PositioningImperativeRef,
} from "@fluentui/react-components";

/** What a popover points at: an element, or a live box with an element for scroll parents. */
export type ConfirmPopoverTarget = Element | { getBoundingClientRect: () => DOMRect; contextElement?: Element };

export type ConfirmPopoverProps = {
  open: boolean;
  /**
   * What the question is about. The popover sits beside it, to its right or
   * wherever there is room, so it stays in view while the user decides.
   */
  target: ConfirmPopoverTarget | null;
  /** The question, e.g. "Swap these stays?". */
  title: ReactNode;
  /** What approving will do, in enough detail to decide. */
  children?: ReactNode;
  /** Defaults to "Approve". */
  approveLabel?: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  onApprove: () => void;
  /** Cancel, Escape and a click elsewhere all land here. */
  onCancel: () => void;
  /**
   * Where it goes, worked out by the caller (to keep clear of what it is
   * about, say), and held there; without it, beside the target wherever
   * there is room.
   */
  placement?: {
    position: "after" | "before" | "below" | "above";
    align: "start" | "center" | "end";
    offset: number;
    withArrow: boolean;
  };
  /** The popover's surface, for a caller that measures it. */
  surfaceRef?: Ref<HTMLDivElement>;
};

const useStyles = makeStyles({
  surface: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    maxWidth: "320px",
  },
  title: {
    margin: 0,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    fontWeight: tokens.fontWeightSemibold,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: tokens.spacingHorizontalS,
    marginTop: tokens.spacingVerticalXS,
  },
});

/**
 * A question with Approve and Cancel, in a Fluent popover beside what it is
 * about: to its right, or wherever there is room. It follows its target as
 * the page scrolls or resizes.
 */
export function ConfirmPopover({
  open,
  target,
  title,
  children,
  approveLabel = "Approve",
  cancelLabel = "Cancel",
  onApprove,
  onCancel,
  placement,
  surfaceRef,
}: ConfirmPopoverProps) {
  const styles = useStyles();
  const positioningRef = useRef<PositioningImperativeRef>(null);

  // Stays beside the targets while anything scrolls or resizes, once per frame at most.
  useEffect(() => {
    if (!open || !target) return undefined;
    let frame = 0;
    const follow = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          positioningRef.current?.updatePosition();
        });
      }
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open, target]);

  if (!target) return null;
  return (
    <Popover
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open) onCancel();
      }}
      trapFocus
      withArrow={placement?.withArrow ?? true}
      positioning={
        placement
          ? { target, positioningRef, position: placement.position, align: placement.align, offset: placement.offset, pinned: true }
          : {
              target,
              positioningRef,
              position: "after",
              align: "center",
              offset: 8,
              fallbackPositions: ["before", "below", "above"],
            }
      }
    >
      <PopoverSurface
        ref={surfaceRef}
        className={styles.surface}
        aria-label={typeof title === "string" ? title : undefined}
      >
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.body}>{children}</div>
        <div className={styles.actions}>
          <Button size="small" appearance="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button size="small" appearance="primary" onClick={onApprove}>
            {approveLabel}
          </Button>
        </div>
      </PopoverSurface>
    </Popover>
  );
}
