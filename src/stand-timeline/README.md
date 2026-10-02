# stand-timeline

A chart-neutral, composable stand/gate occupancy timeline. Import only from `index.ts`.

## Boundaries

- **Imports:** only React and browser APIs. It must not import the app, Coral or Fluent components, or any airport-specific code.
- **Controlled:** the host owns `rows`, `occupancies`, `visits` and `selectedIds`. The chart emits typed `ChartIntent`s through `onIntent` and never mutates data.
- **No operational rules:** allocation and conflict rules live outside this module. The chart neither validates nor resolves anything. In this starter, overlapping intervals on the same row are simply drawn over each other.
- **Visit vs occupancy:** a `Visit` is an identity, for example one aircraft ground stay. An `Occupancy` is one interval on one row. A visit may have several occupancies, such as a tow or a split stay. When one occupancy is selected, the chart outlines its siblings.

## Theming

- **Variables:** colours, typography (SVG text included), spacing and stroke widths all come from `--st-*` variables in `stand-timeline.css`. Hosts set them through the `style` prop. The demo does this by mapping Fluent tokens in `stand-timeline-demo/theme.tsx`.
- **Transparent by default:** the chart has no backdrop of its own. Only the pinned stand column and the header corner use `--st-pinned-bg`, so bars that scroll under them stay hidden. The header and footer also get it when `maxHeight` or `fillHeight` pins them.
- **Fill height:** `fillHeight` makes the chart fill a parent with a definite height. The rulers stay pinned at the top and bottom of the chart's single scroll area, and only the rows scroll vertically between them. Horizontal scrolling stays shared across the rulers, gutter and body.

## Composition

`<StandTimeline>` renders its children once per region (`corner`, `axis`, `labels`, `plot`). Each layer draws only where it applies, and child order sets the stacking order.

```tsx
<StandTimeline rows={rows} occupancies={occs} visits={visits} domain={[t0, t1]}
               timeZone="UTC" selectedIds={sel} onIntent={handle}>
  <StandRows />
  <TimeGrid />
  <OccupancyBars barStyle={(bar) => ({ fill: "…" })} />
  <BarLabels text={(bar) => "…"} />
  <TimeAxis />
</StandTimeline>
```

There are three ways to customize it:

1. **Accessors:** `barStyle`, `text`, `slots`, `color`, `describe`, `renderLabel`.
   - `BarLabels.slots` returns `start`, `center` and `end` slots, each with a primary line and an optional second line. A second line is shown only when the bar is at least 2 × `linePitch` tall.
   - When space is short, the longest prefix of `priority` that fits without truncation is shown. Otherwise only the first slot is shown, truncated with an ellipsis; if not even that fits, nothing is shown.
   - A slot can carry decorative `leading` or `trailing` icons: any SVG node sized at 1em. They are vertically centred beside the whole text stack, sized by `iconSize`, and inset by `iconMargin` on both sides. Each icon counts as `iconMargin + iconSize + iconMargin + iconGap` toward the fit. An icon is only ever shown together with its text.
   - Bars are plain rectangles. Clipping at the window edge is described in text through `describeClipping(bar)`.
   - Slots never overlap, and each is clipped to its own width. Full details belong in `describe`, which supplies both the accessible name and the tooltip.
2. **`renderBar`:** replaces a bar's visuals. The chart keeps focus, click handling and the selection outline.
3. **Custom layers:** call `useTimeline()` and `useTimelineRegion()` to draw in the shared coordinate space.

## Rulers and gutter

- **Ruler placement:** `axes` (`"top"` by default, or `"bottom"` or `"both"`) decides which rulers the root lays out. Add one `<TimeAxis position="top" | "bottom" />` for each enabled ruler. Both rulers use the same scale and scroll container, so their ticks line up.
- **Tick labels:** `format` may return a string, `{ text, anchor }` to set the anchor per tick (`"start"`, `"middle"` or `"end"`, offset from the tick by `labelOffset`), or null for a tick with no label.
- **Label collisions:** when labels would overlap, those with higher `labelPriority` win and the others are dropped. Labels never move off their timestamp.
- **Tick lengths:** short ticks point toward the plot. Ticks on multiples of `majorMs` run the full height of the ruler.
- **Stand gutter:** `StandRows` accepts `labelAlign="end"` for right-aligned IDs, `showGroup={false}` to hide group names, and `title={null}`. A `row.group` change still draws a divider across both the gutter and the plot.

## Not yet included

Drag, resize, zoom, virtualization, overlap lanes and conflict overlays.
