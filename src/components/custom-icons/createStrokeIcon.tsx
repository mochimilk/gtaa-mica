import type * as React from "react";

export type StrokeIconSize = 16 | 20 | 24;
export type StrokeIconProps = React.SVGProps<SVGSVGElement>;

/*
 * Fluent's Regular icons draw 1px outlines at 16 and 20px and 1.5px at 24px.
 * Custom icons are stroked paths on a 24-unit grid, so the stroke width is
 * scaled to land on the same pixel weight at each size, and they sit beside
 * Fluent icons as one family.
 */
const STROKE_PX: Record<StrokeIconSize, number> = { 16: 1, 20: 1, 24: 1.5 };

/**
 * A fixed-size icon from stroked 24×24 paths, used like a Fluent sized icon
 * (e.g. `Airplane20Regular`): decorative, coloured by `currentColor`.
 */
export function createStrokeIcon(displayName: string, size: StrokeIconSize, paths: readonly string[]) {
  const Icon = (props: StrokeIconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={(STROKE_PX[size] * 24) / size}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...props}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
  Icon.displayName = displayName;
  return Icon;
}
