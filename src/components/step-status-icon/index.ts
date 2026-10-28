// Luma's step status icon (dxb-luma src/components/StepStatusIcon.tsx): its
// status type is declared in place of Luma's src/types import, and Mica adds
// one status, pending approval (a half hint circle and its morphs), built from
// Luma's phases; every state is boxed at 32px. Keep its motion in step with
// Luma's; Skye's cursor takes off from its spinner (see agent-cursor's
// cursorMotion.ts, which finds the dots' svg inside the box), so a change
// there needs one here too.
export { StepStatusIcon } from "./StepStatusIcon";
export type { StepStatusIconProps, TaskStepStatus } from "./StepStatusIcon";
