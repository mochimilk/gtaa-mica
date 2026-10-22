import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { loadDemoDataset, ORIGINAL_DATASET } from "./load-dataset";
import { DEFAULT_DEMO_PREFERENCES, DEMO_STORAGE_KEY, parseDemoPreferences, type DemoPreferences } from "./preferences";
import type { DemoDataset } from "./dataset";

interface DemoValue {
  dataset: DemoDataset;
  preferences: DemoPreferences;
  loading: boolean;
  error: string | null;
  apply: (preferences: DemoPreferences) => Promise<boolean>;
}
const DemoContext = createContext<DemoValue | null>(null);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState({ dataset: ORIGINAL_DATASET, preferences: DEFAULT_DEMO_PREFERENCES });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      try {
        const saved = localStorage.getItem(DEMO_STORAGE_KEY);
        if (saved !== null) {
          const preferences = parseDemoPreferences(JSON.parse(saved));
          const dataset = await loadDemoDataset(preferences);
          if (!cancelled) setActive({ preferences, dataset });
        }
      } catch (failure) {
        if (!cancelled) setError(`Could not restore demo settings. Original demo is active. ${errorMessage(failure)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void restore();
    return () => { cancelled = true; };
  }, []);

  const apply = useCallback(async (requested: DemoPreferences) => {
    setLoading(true);
    setError(null);
    try {
      const preferences = parseDemoPreferences(requested);
      const dataset = await loadDemoDataset(preferences);
      let storageError: string | null = null;
      try {
        localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(preferences));
      } catch (failure) {
        storageError = `Demo changed for this session, but settings could not be saved. ${errorMessage(failure)}`;
      }
      setActive({ preferences, dataset });
      setError(storageError);
      return true;
    } catch (failure) {
      setError(`Demo was not changed. ${errorMessage(failure)}`);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);
  const value = useMemo(() => ({ ...active, loading, error, apply }), [active, loading, error, apply]);
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const value = useContext(DemoContext);
  if (!value) throw new Error("useDemo must be used inside DemoProvider");
  return value;
}
