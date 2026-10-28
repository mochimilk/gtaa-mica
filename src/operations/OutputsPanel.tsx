// The Outputs panel: a Coral Panel.Right beside the board, listing every change
// to it (outputs.ts), newest first: each request Skye worked on, and each
// thing the user did, as a collapsible group like the operations panel's,
// headed by who made it (Fluent's Avatar), with every piece it changed under
// it, turn by turn (OutputSteps); picking a piece takes the user to it on the
// board, as picking a flight in the operations panel does. While Skye's changes wait to be approved,
// the decision sits at its foot (OutputsApproval). Its toggle sits at the end
// of the board's header, after Filters and Views; it starts closed, and while
// there is nothing to list the toggle is greyed out and an open panel closes.
// While it is closed, the request Skye is on peeks out under the header
// (OutputsPeek).
import { Fragment, useEffect, useMemo, useSyncExternalStore } from "react";
import { Panel, eventBus, useCoralAuth } from "@coral-ai/react";
import { Avatar, Caption1, makeStyles, tokens } from "@fluentui/react-components";
import { Branch20Filled, Branch20Regular, bundleIcon, createFluentIcon } from "@fluentui/react-icons";
import { skyeOrbStill } from "../components/orb";
import { RightPanelToggle } from "../components/panel-toggle";
import { flightsAtStay } from "./allocation";
import { selectedFlight, useOperations } from "./OperationsContext";
import { describeApprovers, formatLogTime, type OutputActor, type OutputDecision, type OutputRequest, type OutputStep } from "./outputs";
import { OutputsApproval } from "./OutputsApproval";
import { OUTPUT_ICON_GAP, OutputSteps, RequestMeta, useOutputs } from "./OutputSteps";
import { revealRect } from "./SelectionPopover";
import { skyeReview, subscribeSkyeReview } from "./skyeReview";
import { KEEP_SELECTION_ATTR } from "./ViewsFiltersToolbar";
import "./operations.css";

/*
 * The panel's icon, on its toggle: a branch, with the alerts bell's red dot
 * (AlertsMenu) while Skye's changes wait to be approved. The dot is r 3.5 at
 * 15.75,4, as the bell's is, and the branch's right node is cut 1 unit clear
 * of it. The dot is each icon's last path, so it can be coloured on its own
 * (.ops-outputs-branch in operations.css).
 */
const BRANCH_DOT = "M12.25 4a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0Z";
const BranchDotRegular = createFluentIcon("BranchDotRegular", "20", [
  "M10 5a3 3 0 0 1-2.15 2.88A5.76 5.76 0 0 0 12 9.98A3 3 0 0 1 13.13 7.66A4.5 4.5 0 0 0 14.13 8.2A2 2 0 1 0 16.29 8.47A4.5 4.5 0 0 0 17.39 8.19A3 3 0 1 1 12.17 10.99A6.8 6.8 0 0 1 7.5 9v3.05a3 3 0 1 1-1 0V7.96A3 3 0 1 1 10 5ZM7 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM7 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  BRANCH_DOT,
]);
const BranchDotFilled = createFluentIcon("BranchDotFilled", "20", [
  "M10 5a3 3 0 0 1-2.15 2.88A5.76 5.76 0 0 0 12 9.98A3 3 0 0 1 13.13 7.66A4.5 4.5 0 0 0 17.39 8.19A3 3 0 1 1 12.17 10.99A6.8 6.8 0 0 1 7.5 9v3.05a3 3 0 1 1-1 0V7.96A3 3 0 1 1 10 5Z",
  BRANCH_DOT,
]);
const OutputsIcon = bundleIcon(Branch20Filled, Branch20Regular);
const OutputsWaitingIcon = bundleIcon(BranchDotFilled, BranchDotRegular);

const useApprovalWaiting = () => useSyncExternalStore(subscribeSkyeReview, skyeReview) !== null;

// Stable ID shared by the right panel, its toggle in the board's header and the peek.
export const OUTPUTS_PANEL_ID = "outputs-panel";
const OUTPUTS_PANEL_LABEL = "outputs";

/**
 * How far the 32px icon boxes stand out of the rows' 8px: the avatar (24px,
 * 4px in from its box) then starts 16px in, under the panel's title.
 */
const ICON_OUTSET = "-4px";

const useStyles = makeStyles({
  // 56px with no vertical padding, like PanelHeader, to line up with the
  // board's ContentToolbar.
  toolbar: {
    flexShrink: 0,
    height: "56px",
    paddingTop: 0,
    paddingBottom: 0,
  },
  // Each piece's icon box out by 4px, as the avatar's is.
  row: {
    "& > span > span:first-child": {
      marginLeft: ICON_OUTSET,
    },
  },
  // A 32px box, as each piece's status icon has, so the avatar lines up with
  // them; out by 4px, so the avatar lines up with the panel's title.
  // As Panel.NavGroup's label over its description.
  labelStack: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  labelTitle: {
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  labelMeta: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: tokens.colorNeutralForeground4,
  },
  // The 24px avatar's box, the still overhanging it as LiveOrb's canvas does (1.25x).
  orb: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    height: "24px",
  },
  orbStill: {
    flexShrink: 0,
    width: "30px",
    height: "30px",
  },
  avatarBox: {
    marginLeft: ICON_OUTSET,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "32px",
    height: "32px",
    flexShrink: 0,
  },
  // The requests scroll; the decision stays at the foot.
  content: {
    overflowY: "hidden",
  },
  // An approved request's log, under its pieces: who approved it and when,
  // then each figure before and after, the better ones in the success colour.
  decision: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    margin: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS} ${tokens.spacingVerticalS}`,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  decisionBy: {
    color: tokens.colorNeutralForeground2,
  },
  decisionFigures: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    columnGap: tokens.spacingHorizontalM,
    margin: 0,
    fontVariantNumeric: "tabular-nums",
    "& dt": { color: tokens.colorNeutralForeground3 },
    "& dd": { margin: 0, color: tokens.colorNeutralForeground1 },
  },
  better: {
    color: tokens.colorStatusSuccessForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  requests: {
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    minHeight: 0,
    overflowY: "auto",
    gap: tokens.spacingVerticalXS,
    paddingBottom: tokens.spacingVerticalS,
  },
  approval: {
    flexShrink: 0,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
  },
  request: {
    // Coral fixes the group's header at 36px; with its description it needs more.
    // Its content starts 8px in (its 1px border, then 7px), as each piece's row does.
    "& > button": {
      height: "auto",
      minHeight: "36px",
      paddingLeft: "7px",
      paddingRight: "7px",
    },
    // Coral sets the chevron just after the label; it ends the header instead, in a 24px box.
    // The avatar is as far from the label as a piece's icon is from its text.
    "& > button > span:first-child": {
      flexGrow: 1,
      columnGap: OUTPUT_ICON_GAP,
    },
    "& > button > span:first-child > span:last-child": {
      marginLeft: "auto",
      width: "24px",
      height: "24px",
      justifyContent: "center",
    },
    // Its pieces sit flush with the header, not indented under it.
    "& > div": {
      paddingLeft: 0,
    },
  },
});

/**
 * Who made a request's changes: Skye, as her orb (a still of it, so the
 * history can hold any number without a renderer each), or the signed-in
 * user, as the rail's account button shows them ("You" when no one is signed
 * in). `filled` is what Panel.NavGroup gives its icon on hover; neither has a
 * filled form.
 */
function ActorAvatar({ actor }: { actor: OutputActor; filled?: boolean }) {
  const styles = useStyles();
  const auth = useCoralAuth();
  const user = auth?.status === "signed-in" ? auth.user : undefined;
  return (
    <span className={styles.avatarBox}>
      {actor === "skye" ? (
        <span role="img" aria-label="Skye" className={styles.orb}>
          <img src={skyeOrbStill} alt="" className={styles.orbStill} />
        </span>
      ) : (
        <Avatar
          size={24}
          name={user?.name}
          aria-label={user?.name ?? "You"}
          image={user?.image ? { src: user.image } : undefined}
          idForColor={user?.idForColor}
          color={user?.name ? "colorful" : undefined}
        />
      )}
    </span>
  );
}

/**
 * A request's header: its title over where it stands, as Panel.NavGroup's
 * label and description are, but in the label, as Coral's description takes
 * only plain text and the status is in warning colour while it waits.
 */
function RequestLabel({ request }: { request: OutputRequest }) {
  const styles = useStyles();
  return (
    <span className={styles.labelStack}>
      <span className={styles.labelTitle}>{request.title}</span>
      <Caption1 className={styles.labelMeta}>
        <RequestMeta request={request} />
      </Caption1>
    </span>
  );
}

/** An approved request's logged decision (see skyeReview's approveSkyeChanges). */
function DecisionLog({ decision }: { decision: OutputDecision }) {
  const styles = useStyles();
  return (
    <section className={styles.decision} aria-label="Decision log">
      <Caption1 className={styles.decisionBy}>
        Approved {formatLogTime(decision.at)} by {describeApprovers(decision.by)}
      </Caption1>
      <dl className={styles.decisionFigures}>
        {decision.figures.map((figure) => (
          <Fragment key={figure.label}>
            <dt>
              <Caption1>{figure.label}</Caption1>
            </dt>
            <dd>
              <Caption1>
                {figure.before} → <span className={figure.better ? styles.better : undefined}>{figure.after}</span>
              </Caption1>
            </dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}

/**
 * Opens and closes the Outputs panel, subtle as the Filters and Views beside
 * it; greyed out while there is nothing to list. Its icon is the panel's.
 */
export function OutputsToggle() {
  const empty = useOutputs().length === 0;
  const waiting = useApprovalWaiting();
  return (
    <RightPanelToggle
      {...KEEP_SELECTION_ATTR}
      appearance="subtle"
      panelID={OUTPUTS_PANEL_ID}
      panelLabel={waiting ? `${OUTPUTS_PANEL_LABEL}, changes waiting for approval` : OUTPUTS_PANEL_LABEL}
      disabledLabel={empty ? "No outputs yet" : undefined}
    />
  );
}

/**
 * Takes the user to a piece on the board: its flight selected, its bar brought
 * into view with its details beside it; or, for an area's closure, its band.
 */
function useOpenStep() {
  const { selectFlight } = useOperations();
  return (step: OutputStep) => {
    const flight = step.stayId ? flightsAtStay(step.stayId)[0] : undefined;
    if (flight) {
      selectFlight(flight);
      return;
    }
    const band = document.querySelector("[data-closure-band]");
    const region = band?.closest<HTMLElement>(".st-scroller");
    if (band && region) revealRect(region, band.getBoundingClientRect(), band);
  };
}

export function OutputsPanel() {
  const styles = useStyles();
  const requests = useOutputs();
  const { selection } = useOperations();
  const openStep = useOpenStep();
  // The stays the user has selected: a flight waiting for a stand is selected by its flight.
  const waiting = selectedFlight(selection)?.unplacedStay?.stayId;
  const selectedStayIds = waiting ? [...selection.occupancyIds, waiting] : selection.occupancyIds;
  // On the panel, so every control for it shares it (Coral).
  const waitingApproval = useApprovalWaiting();
  const icon = useMemo(
    () => (waitingApproval ? <OutputsWaitingIcon className="ops-outputs-branch" /> : <OutputsIcon />),
    [waitingApproval],
  );
  // The toggle is greyed out while there is nothing to list, so it could not close the panel.
  useEffect(() => {
    if (requests.length === 0 && eventBus.getActivePanel() === OUTPUTS_PANEL_ID) eventBus.setActivePanel(null);
  }, [requests.length]);

  return (
    <Panel.Right
      panelID={OUTPUTS_PANEL_ID}
      label="Outputs"
      icon={icon}
      defaultOpen={false}
      styles={{ content: styles.content }}
    >
      <Panel.Toolbar title="Outputs" className={styles.toolbar} />
      <div className={styles.requests}>
        {requests.map((request) => (
          <Panel.NavGroup
            key={request.id}
            defaultOpen
            icon={<ActorAvatar actor={request.actor} />}
            label={<RequestLabel request={request} />}
            className={styles.request}
          >
            <OutputSteps
              steps={request.steps}
              rowClassName={styles.row}
              onOpen={openStep}
              selectedStayIds={selectedStayIds}
            />
            {request.decision && <DecisionLog decision={request.decision} />}
          </Panel.NavGroup>
        ))}
      </div>
      <OutputsApproval className={styles.approval} />
    </Panel.Right>
  );
}
