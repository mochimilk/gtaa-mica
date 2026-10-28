// The people called into the call, Teams-style: who can be called in, who is
// being called, who is on, and since when. A placeholder: calling someone in
// only puts them on the call window (see PeopleCallButton); nothing reaches
// them, and they always answer after a few rings. Shared here, not held by
// the People button, so Skye can add and remove people as a person does, and
// both see the same call.

/** What someone works on. The user runs the stands; the rest are teammates. */
export type Expertise = "stands" | "gates" | "ramp" | "apron" | "baggage";

export const EXPERTISE_LABELS: Record<Expertise, string> = {
  stands: "Stand operations",
  gates: "Gate operations",
  ramp: "Ramp services",
  apron: "Apron control",
  baggage: "Baggage operations",
};

/** A made-up teammate, and what they work on. */
export type Person = { name: string; expertise: Expertise };

/** Made-up teammates who can be called in, and who sign off on changes in their area (see skyeReview). */
export const TEAM: readonly Person[] = [
  { name: "Priya Raman", expertise: "gates" },
  { name: "Marcus Chen", expertise: "ramp" },
  { name: "Aisha Okafor", expertise: "apron" },
  { name: "Travis Hughes", expertise: "baggage" },
];

/** The teammates' names, in TEAM's order. */
export const PEOPLE: readonly string[] = TEAM.map((person) => person.name);

/** The teammate who works on `expertise`, if anyone does. */
export const personWith = (expertise: Expertise): Person | undefined =>
  TEAM.find((person) => person.expertise === expertise);

/** What a teammate works on, e.g. "Baggage operations"; undefined for someone not on the team. */
export function expertiseOf(name: string): string | undefined {
  const person = TEAM.find((entry) => entry.name === name);
  return person && EXPERTISE_LABELS[person.expertise];
}

/** How long someone rings before they answer. */
export const ANSWER_MS = 5_000;

/**
 * People called in: who is on, in the order they answered; who is still being
 * called, in the order they were; and when the first one answered (null until
 * someone has). Null when nobody has been called.
 */
export type CallGuests = { names: readonly string[]; calling: readonly string[]; since: number | null } | null;

let guests: CallGuests = null;
const listeners = new Set<() => void>();
/** The pending answer for each person being called. */
const answers = new Map<string, ReturnType<typeof setTimeout>>();

function set(next: CallGuests): void {
  if (next === guests) return;
  guests = next;
  for (const listener of listeners) listener();
}

/** Nobody on and nobody being called ends the people call. */
function settle(names: readonly string[], calling: readonly string[], since: number | null): void {
  set(names.length > 0 || calling.length > 0 ? { names, calling, since } : null);
}

/** For useSyncExternalStore. */
export const callGuests = (): CallGuests => guests;
export function subscribeCallGuests(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The names of everyone on the call, in the order they answered. */
export const guestNames = (): readonly string[] => guests?.names ?? [];

/** The names of everyone being called who has not answered yet. */
export const callingNames = (): readonly string[] => guests?.calling ?? [];

/** Someone being called answers and joins. */
function answer(name: string): void {
  answers.delete(name);
  if (!guests?.calling.includes(name)) return;
  settle(
    [...guests.names, name],
    guests.calling.filter((guest) => guest !== name),
    guests.since ?? Date.now(),
  );
}

/** Calls someone in; they join once they answer. Nothing changes when they are on or being called already. */
export function inviteToCall(name: string): void {
  if (guests?.names.includes(name) || guests?.calling.includes(name)) return;
  settle(guests?.names ?? [], [...(guests?.calling ?? []), name], guests?.since ?? null);
  answers.set(name, setTimeout(() => answer(name), ANSWER_MS));
}

/** Takes someone off the call, or stops calling them; with nobody left, the people call ends. */
export function removeFromCall(name: string): void {
  if (!guests || (!guests.names.includes(name) && !guests.calling.includes(name))) return;
  clearTimeout(answers.get(name));
  answers.delete(name);
  const drop = (list: readonly string[]) => list.filter((guest) => guest !== name);
  settle(drop(guests.names), drop(guests.calling), guests.since);
}

/** Ends the call for everyone called in, and stops calling anyone still ringing. */
export function endGuestCall(): void {
  for (const timer of answers.values()) clearTimeout(timer);
  answers.clear();
  set(null);
}

/**
 * Someone in PEOPLE by what was said or typed: the full name or the first
 * name, in any case ("marcus", "Marcus Chen"). Undefined when it names nobody
 * there, or more than one person.
 */
export function findPerson(spoken: string): string | undefined {
  const wanted = spoken.trim().toLowerCase().replace(/\s+/g, " ");
  if (!wanted) return undefined;
  const exact = PEOPLE.find((name) => name.toLowerCase() === wanted);
  if (exact) return exact;
  const byFirst = PEOPLE.filter((name) => name.toLowerCase().split(" ")[0] === wanted);
  return byFirst.length === 1 ? byFirst[0] : undefined;
}
