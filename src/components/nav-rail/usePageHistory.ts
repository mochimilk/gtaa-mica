import { useCallback, useState } from "react";

/** The pages visited in turn, and which of them is on screen. */
type Visits<T> = { pages: readonly T[]; at: number };

export type PageHistory<T> = {
  /** The page on screen. */
  page: T;
  /** Goes to a page as a new visit, dropping any gone back from, as a browser does. */
  go: (page: T) => void;
  /** Back to the page before; undefined on the first. */
  back?: () => void;
  /** On to the page gone back from; undefined on the last. */
  forward?: () => void;
};

/**
 * The pages the user has been on, kept as a browser keeps its history, for
 * the desktop title bar's Back and Forward. Going to the page already on
 * screen adds no visit.
 */
export function usePageHistory<T>(first: T): PageHistory<T> {
  const [visits, setVisits] = useState<Visits<T>>({ pages: [first], at: 0 });
  const go = useCallback(
    (page: T) =>
      setVisits((current) =>
        current.pages[current.at] === page
          ? current
          : { pages: [...current.pages.slice(0, current.at + 1), page], at: current.at + 1 },
      ),
    [],
  );
  const back = useCallback(() => setVisits(({ pages, at }) => ({ pages, at: Math.max(0, at - 1) })), []);
  const forward = useCallback(
    () => setVisits(({ pages, at }) => ({ pages, at: Math.min(pages.length - 1, at + 1) })),
    [],
  );
  return {
    page: visits.pages[visits.at],
    go,
    back: visits.at > 0 ? back : undefined,
    forward: visits.at < visits.pages.length - 1 ? forward : undefined,
  };
}
