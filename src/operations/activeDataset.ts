import { createFixtureDataset } from "../stand-timeline-demo/fixtureDataset";

// One dataset per page session. Switching needs an explicit lifecycle for the
// editor, pending agent work and derived caches; do not replace this in place.
export const ACTIVE_DATASET = createFixtureDataset();

if (import.meta.hot) import.meta.hot.accept(() => location.reload());
