import { Caption1 } from "@fluentui/react-components";
import { ACTIVE_DATASET } from "../operations/activeDataset";
import { KpiStrip } from "../operations/KpiStrip";

export function SourceSummary() {
  if (ACTIVE_DATASET.capabilities.fixtureAnalyses) return <KpiStrip />;
  return (
    <div role="status">
      <strong>{ACTIVE_DATASET.label}</strong>
      <br />
      <Caption1>{ACTIVE_DATASET.summary}</Caption1>
    </div>
  );
}
