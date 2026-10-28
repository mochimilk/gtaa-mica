// Whether the app is at rest: its window hidden or not focused, or left
// untouched for a while with nothing of Skye's going on (holdAwake: a call, a
// request she is working on). At rest, decorative motion stops, so an idle
// app draws no frames: LiveOrb stops its renderer, SkyeGlowDefs pauses its
// gradients, and the CSS animations that loop forever are paused here. Any
// input, or the window regaining focus, wakes it. data-at-rest on the root
// element shows it in DevTools; nothing styles by it, since a rule keyed on
// the root restyles the whole page (some 50ms) each time it changes.
import { useSyncExternalStore } from "react";

/** How long after the user's last input the app comes to rest. */
export const REST_AFTER_MS = 20_000;

/** What counts as the user being there. Pointer moves too: someone reading the board moves it. */
const INPUT_EVENTS = ["pointermove", "pointerdown", "keydown", "wheel"] as const;

let atRest = false;
let holds = 0;
let lastInput = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;
const listeners = new Set<() => void>();
/** The looping animations paused at rest, to play again on waking. */
let pausedLoops: Animation[] = [];

function pauseLoops() {
  pausedLoops = document
    .getAnimations()
    .filter((animation) => animation.playState === "running" && animation.effect?.getComputedTiming().endTime === Infinity);
  for (const animation of pausedLoops) animation.pause();
}

// Only those still paused: one whose element has since lost its animation is
// gone, and playing it would bring it back.
function playLoops() {
  for (const animation of pausedLoops) if (animation.playState === "paused") animation.play();
  pausedLoops = [];
}

function set(next: boolean) {
  if (next === atRest) return;
  atRest = next;
  document.documentElement.toggleAttribute("data-at-rest", next);
  if (next) pauseLoops();
  else playLoops();
  for (const listener of listeners) listener();
}

function update() {
  clearTimeout(timer);
  timer = undefined;
  if (holds > 0) return set(false);
  if (document.hidden || !document.hasFocus()) return set(true);
  const idle = performance.now() - lastInput;
  if (idle >= REST_AFTER_MS) return set(true);
  set(false);
  timer = setTimeout(update, REST_AFTER_MS - idle);
}

// Runs on every pointer move, so it only notes the time; the pending timer
// checks it when it fires.
function onInput() {
  lastInput = performance.now();
  if (atRest) update();
}

function wake() {
  lastInput = performance.now();
  update();
}

// For the app's lifetime, from the first subscriber on.
function start() {
  if (started) return;
  started = true;
  lastInput = performance.now();
  for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { capture: true, passive: true });
  window.addEventListener("focus", wake);
  window.addEventListener("blur", update);
  document.addEventListener("visibilitychange", wake);
  update();
}

const subscribe = (listener: () => void) => {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Whether the app is at rest, re-rendering on a change. */
export function useAtRest(): boolean {
  return useSyncExternalStore(subscribe, () => atRest, () => false);
}

/**
 * Keeps the app awake, whatever the input and focus, until the returned
 * release is called: for as long as Skye is visibly busy.
 */
export function holdAwake(): () => void {
  start();
  holds++;
  update();
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holds--;
    // A fresh while before resting, so the app doesn't rest the moment Skye finishes.
    wake();
  };
}
