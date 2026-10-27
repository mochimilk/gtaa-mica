import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { loadDemoDataset, ORIGINAL_DATASET } from "./load-dataset";
import { DEFAULT_DEMO_PREFERENCES, DEMO_STORAGE_KEY, parseDemoPreferences, type DemoPreferences } from "./preferences";
import type { DemoDataset } from "./dataset";
import { acceptAccommodation } from "./accommodation-evaluation";
import { DEFAULT_GATE_WAIT_PROFILE } from "./gate-wait-evaluation";

interface DemoValue {
  dataset: DemoDataset;
  preferences: DemoPreferences;
  loading: boolean;
  error: string | null;
  apply: (preferences: DemoPreferences) => Promise<boolean>;
  approvedDataset: DemoDataset;
  acceptedOptionId: string | null;
  acceptedAssumptionId: string | null;
  chooseAccommodation: (optionId: string | null, assumptionId?: string) => boolean;
}
const DemoContext = createContext<DemoValue | null>(null);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<{
    dataset: DemoDataset; approvedDataset: DemoDataset; preferences: DemoPreferences;
    acceptedOptionId: string | null; acceptedAssumptionId: string | null;
  }>({ dataset: ORIGINAL_DATASET, approvedDataset: ORIGINAL_DATASET, preferences: DEFAULT_DEMO_PREFERENCES, acceptedOptionId: null, acceptedAssumptionId: null });
  const [decisionRevision, setDecisionRevision] = useState(0);
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
          if (!cancelled) setActive({ preferences, dataset, approvedDataset: dataset, acceptedOptionId: null, acceptedAssumptionId: null });
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
      setActive({ preferences, dataset, approvedDataset: dataset, acceptedOptionId: null, acceptedAssumptionId: null });
      setDecisionRevision(0);
      setError(storageError);
      return true;
    } catch (failure) {
      setError(`Demo was not changed. ${errorMessage(failure)}`);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);
  const chooseAccommodation = useCallback((optionId: string | null, assumptionId?: string) => {
    try {
      if (loading) throw new Error("Wait for the selected demo to finish loading.");
      if (!active.approvedDataset.prepared?.accommodation) throw new Error("This dataset has no prepared late request.");
      const reviewAssumption = optionId === null ? undefined : DEFAULT_GATE_WAIT_PROFILE.assumptions.find(item => item.id === assumptionId);
      if (optionId !== null && !reviewAssumption) throw new Error("A known synthetic waiting assumption is required for the session decision.");
      const dataset = optionId === null ? active.approvedDataset : acceptAccommodation(active.approvedDataset, optionId);
      setActive({ ...active, dataset, acceptedOptionId: optionId, acceptedAssumptionId: reviewAssumption ? reviewAssumption.id : null });
      setError(null);
      setDecisionRevision(current => current + 1);
      return true;
    } catch (failure) {
      setError(`Accommodation choice was not applied. ${errorMessage(failure)}`);
      return false;
    }
  }, [active, loading]);
  useEffect(() => {
    if (decisionRevision) document.getElementById("accommodation-trigger")?.focus({ preventScroll: true });
  }, [decisionRevision]);
  const value = useMemo(() => ({ ...active, loading, error, apply, chooseAccommodation }), [active, loading, error, apply, chooseAccommodation]);
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const value = useContext(DemoContext);
  if (!value) throw new Error("useDemo must be used inside DemoProvider");
  return value;
}
