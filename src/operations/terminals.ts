// The airport's terminals, as the stand areas fall in them. Made up, as the
// teammates are, until the airport's own boundaries are known. A change's
// terminal is whose channel Skye calls for an approval: an area's teams are
// divided by terminal, one channel each (../chat/chatThreads), and whoever is
// on duty there answers.
import { standArea } from "./allocation";

export const TERMINALS: readonly { name: string; areas: readonly string[] }[] = [
  { name: "Terminal A", areas: ["Pier A", "Pier B"] },
  { name: "Terminal B", areas: ["Pier C", "Pier D", "Remote"] },
];

/** The terminal a stand is in; undefined for no stand. */
export function terminalOf(standId: string): string | undefined {
  const area = standId ? standArea(standId) : undefined;
  return area ? TERMINALS.find((terminal) => terminal.areas.includes(area))?.name : undefined;
}
