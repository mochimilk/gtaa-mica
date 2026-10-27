import * as React from "react";

const pad = (value: number) => String(value).padStart(2, "0");

/** Elapsed call time as HH:MM:SS, the way Teams shows it. */
export function formatCallDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

/**
 * How long the call has run, as HH:MM:SS, from `startedAt` (epoch ms). Reads
 * 00:00:00 until the call has started. Each tick lands just past a whole
 * second of call time, so the clock never skips or repeats a second.
 */
export function useCallDuration(startedAt: number | null): string {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (startedAt === null) return undefined;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      timer = setTimeout(tick, 1000 - ((current - startedAt) % 1000) + 10);
    };
    tick();
    return () => clearTimeout(timer);
  }, [startedAt]);

  return formatCallDuration(startedAt === null ? 0 : now - startedAt);
}
