// The Studio page: pixel drawings for the board's aircraft types, one per
// type, shown on every aircraft of that type. The left panel lists the types
// that have a drawing (or unsaved edits), and New drawing starts one for
// another. The one open fills the content area: the aircraft's name in the
// header, with Discard and Save at its end, and its canvas centred, the
// floating toolbar's tools down its left. Drawings are one colour, the text
// colour around them (see ./drawings).
import { useRef, useState, type KeyboardEvent } from "react";
import { Panel } from "@coral-ai/react";
import { Button, Tooltip } from "@fluentui/react-components";
import { Add } from "@coral-ai/bundleicons/Add";
import { ArrowReset } from "@coral-ai/bundleicons/ArrowReset";
import { Save } from "@coral-ai/bundleicons/Save";
import { ContentToolbar } from "../components/content-toolbar";
import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from "../components/menu";
import { NorvaraLogo } from "../components/navbar/NorvaraLogo";
import { PanelHeader } from "../components/panel-header";
import { DEMO_DATA } from "../stand-timeline-demo/demoData";
import { AIRCRAFT_MAKER } from "../stand-timeline-demo/syntheticFixture";
import {
  BLANK,
  discardDraft,
  isBlank,
  saveDrawing,
  setDraft,
  useDrafts,
  useDrawings,
  type Pixels,
} from "./drawings";
import { PixelArt, crispSize } from "./PixelArt";
import { PixelCanvas, type Tool } from "./PixelCanvas";
import { StudioTools, TOOLS } from "./StudioTools";
import "./studio.css";

/** An aircraft type, as the Studio names it. */
interface Aircraft {
  /** E.g. "A320". */
  type: string;
  /** E.g. "Airbus"; undefined when none is on record. */
  maker?: string;
  /** Its maker and type, e.g. "Airbus A320". */
  name: string;
  /** How many aircraft of the type are on the board. */
  count: number;
}

const counts = new Map<string, number>();
for (const turn of DEMO_DATA.turnsById.values()) {
  if (turn.aircraftType) counts.set(turn.aircraftType, (counts.get(turn.aircraftType) ?? 0) + 1);
}
const aircraftOf = (type: string): Aircraft => ({
  type,
  maker: AIRCRAFT_MAKER[type],
  name: AIRCRAFT_MAKER[type] ? `${AIRCRAFT_MAKER[type]} ${type}` : type,
  count: counts.get(type) ?? 0,
});
const byName = (a: Aircraft, b: Aircraft) => a.name.localeCompare(b.name);
/** Every type on the board, or with a maker on record. */
const ALL_AIRCRAFT = [...new Set([...counts.keys(), ...Object.keys(AIRCRAFT_MAKER)])].map(aircraftOf).sort(byName);
const onBoard = (a: Aircraft) => `${a.count} on the board`;

/** How many strokes undo goes back. */
const HISTORY_LIMIT = 100;

/** The open drawing's undo and redo, for the aircraft type they were made on. */
interface History {
  type?: string;
  past: readonly Pixels[];
  future: readonly Pixels[];
}

export interface StudioPageProps {
  /** The drawings panel's Panel.Left id, shared with its toggle in the nav rail. */
  panelID: string;
  panelClassName?: string;
}

export function StudioPage({ panelID, panelClassName }: StudioPageProps) {
  const drawings = useDrawings();
  const drafts = useDrafts();
  // The panel's types: those with a drawing or unsaved edits, by name.
  const listed = new Set([...drawings.keys(), ...drafts.keys()]);
  const [type, setType] = useState<string | undefined>(() => [...listed].map(aircraftOf).sort(byName)[0]?.type);
  // One just started stays listed, blank, until another is opened.
  if (type) listed.add(type);
  const list = [...listed].map(aircraftOf).sort(byName);

  const [tool, setTool] = useState<Tool>("pencil");
  const [history, setHistory] = useState<History>({ past: [], future: [] });
  const { past, future } = history.type === type ? history : { past: [], future: [] };
  // The pixels as a stroke began; kept for undo once the stroke changes them.
  const strokeBase = useRef<Pixels | null>(null);

  const aircraft = type ? aircraftOf(type) : undefined;
  const pixels = (type && (drafts.get(type) ?? drawings.get(type))) || BLANK;
  const unsaved = !!type && drafts.has(type);

  const change = (next: Pixels) => {
    if (!type) return;
    const before = strokeBase.current;
    if (before) {
      strokeBase.current = null;
      setHistory({ type, past: [...past, before].slice(-HISTORY_LIMIT), future: [] });
    }
    setDraft(type, next);
  };
  const undo = () => {
    if (!type || past.length === 0) return;
    setHistory({ type, past: past.slice(0, -1), future: [pixels, ...future] });
    setDraft(type, past[past.length - 1]);
  };
  const redo = () => {
    if (!type || future.length === 0) return;
    setHistory({ type, past: [...past, pixels], future: future.slice(1) });
    setDraft(type, future[0]);
  };
  const clear = () => {
    strokeBase.current = pixels;
    change(BLANK);
  };
  const save = () => type && saveDrawing(type);
  const discard = () => {
    if (!type) return;
    discardDraft(type);
    setHistory({ type, past: [], future: [] });
  };

  // Shortcuts anywhere in the editor, but not while typing.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("input, textarea")) return;
    const key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      const action =
        key === "z" && !e.shiftKey ? undo : key === "y" || (key === "z" && e.shiftKey) ? redo : key === "s" ? save : null;
      if (action) {
        e.preventDefault();
        action();
      }
      return;
    }
    const shortcut = !e.altKey && TOOLS.find((t) => t.key.toLowerCase() === key);
    if (shortcut) setTool(shortcut.tool);
  };

  return (
    <div className="studio">
      <Panel.Left panelWidth={320} panelID={panelID} className={panelClassName}>
        <PanelHeader logo={<NorvaraLogo />} />
        <div className="studio-panel">
          <Panel.NavSection label="Aircraft" collapsible={false} actions={<NewDrawing taken={listed} onPick={setType} />}>
            {list.map((a) => {
              const draft = drafts.get(a.type);
              // Edits not saved yet, a new drawing's included: a dot at the item's end.
              const unsavedHere = !!draft || !drawings.has(a.type);
              return (
                <Panel.NavItem
                  key={a.type}
                  value={a.type}
                  className="studio-nav-item"
                  label={a.type}
                  description={a.maker}
                  icon={<DrawingThumb pixels={draft ?? drawings.get(a.type) ?? BLANK} />}
                  actions={
                    unsavedHere && (
                      <span className="studio-unsaved">
                        <span className="studio-visually-hidden">, unsaved</span>
                      </span>
                    )
                  }
                  selected={a.type === type}
                  onSelect={() => setType(a.type)}
                />
              );
            })}
          </Panel.NavSection>
        </div>
      </Panel.Left>

      <main className="studio-main" onKeyDown={onKeyDown}>
        <ContentToolbar
          label={
            aircraft ? (
              <>
                {aircraft.name}
                <span className="studio-title-meta"> · {onBoard(aircraft)}</span>
              </>
            ) : (
              "Studio"
            )
          }
          actionsEnd={
            aircraft && (
              <>
                <Button appearance="subtle" icon={<ArrowReset />} disabledFocusable={!unsaved} onClick={discard}>
                  Discard
                </Button>
                <Tooltip
                  content={
                    isBlank(pixels) && drawings.has(aircraft.type)
                      ? `Saving an empty canvas takes the drawing off every ${aircraft.type}`
                      : `Show this drawing on every ${aircraft.type} on the board (Ctrl+S)`
                  }
                  relationship="description"
                >
                  <Button appearance="primary" icon={<Save />} disabledFocusable={!unsaved} onClick={save}>
                    Save
                  </Button>
                </Tooltip>
              </>
            )
          }
        />
        <div className="studio-stage">
          {aircraft ? (
            <>
              <PixelCanvas
                key={aircraft.type}
                pixels={pixels}
                label={aircraft.name}
                tool={tool}
                onStrokeStart={() => {
                  strokeBase.current = pixels;
                }}
                onChange={change}
              />
              <StudioTools
                tool={tool}
                onToolChange={setTool}
                canUndo={past.length > 0}
                canRedo={future.length > 0}
                canClear={!isBlank(pixels)}
                onUndo={undo}
                onRedo={redo}
                onClear={clear}
              />
            </>
          ) : (
            <p className="studio-empty">No drawing open. Start one with New drawing in the panel.</p>
          )}
        </div>
      </main>
    </div>
  );
}

/**
 * A drawing in the panel's list, about 18px square and centred in a 32px
 * one, in the item's icon colour; a dashed square while it is blank. NavItem
 * passes its icon `filled` on hover and selection, which a drawing has no
 * use for.
 */
function DrawingThumb({ pixels }: { pixels: Pixels; filled?: boolean }) {
  return (
    <span className="studio-thumb">
      {isBlank(pixels) ? <span className="studio-thumb-blank" /> : <PixelArt pixels={pixels} size={crispSize(18)} />}
    </span>
  );
}

/** The panel's New drawing button: a menu of the aircraft types with no drawing yet, to open one blank. */
function NewDrawing({ taken, onPick }: { taken: ReadonlySet<string>; onPick: (type: string) => void }) {
  const options = ALL_AIRCRAFT.filter((a) => !taken.has(a.type));
  if (options.length === 0) {
    return (
      <Tooltip content="Every aircraft type has a drawing" relationship="label">
        <Button appearance="subtle" icon={<Add />} disabledFocusable />
      </Tooltip>
    );
  }
  return (
    <Menu positioning="below-end">
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content="New drawing" relationship="label">
          <Button appearance="subtle" icon={<Add />} />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {options.map((a) => (
            <MenuItem key={a.type} secondaryContent={a.maker} onClick={() => onPick(a.type)}>
              {a.type}
            </MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
