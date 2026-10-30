import { createContext, useContext } from "react";

export type RequestDecision = { type: "restore" } | { type: "accept"; optionId: string; assumptionId: string };
export const RequestContext = createContext<{
  open: () => void;
  decide: (decision: RequestDecision) => void;
} | null>(null);

export function useRequests() {
  const context = useContext(RequestContext);
  if (!context) throw new Error("Request actions require RequestsProvider.");
  return context;
}
