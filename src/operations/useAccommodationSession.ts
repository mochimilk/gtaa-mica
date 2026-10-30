import { useSyncExternalStore } from "react";
import { accommodationSession, subscribeAccommodationSession } from "./accommodationSession";

export function useAccommodationSession() {
  return useSyncExternalStore(subscribeAccommodationSession, accommodationSession, accommodationSession);
}
