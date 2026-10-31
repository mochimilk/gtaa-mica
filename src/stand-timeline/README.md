# stand-timeline

A chart-neutral, composable stand/gate occupancy timeline. Import only from `index.ts`.

## Boundaries

- **Imports:** only React and browser APIs. It must not import the app, Coral or Fluent components, or any airport-specific code.
- **Controlled:** the host owns `rows`, `occupancies`, `visits` and `selectedIds`. The chart emits typed `ChartIntent`s through `onIntent` and never mutates data.
- **Drag (optional):** pass `previewDrop(occupancyId, rowId, shiftMs)` and bars can be dragged up or down to another row. Add `dragSnapMs` and they can be dragged along the time axis too, in steps of that many ms, so a bar can go anywhere on the plot; without it they keep their times. A little sideways travel (12px) is ignored, so a drag straight up or down keeps its times. While dragging, the chart draws a see-through ghost where the bar would land, green where the host's `DropPreview` allows the drop and red where it does not (with `swapWithId`, a ghost of the bar it would trade with on the dragged bar's row), and the new times beside it when they change. A drop the host allowed emits `{ type: "move", occupancyId, rowId, shiftMs }`; what that means (a move, a retime, a swap) is the host's decision. Escape cancels a drag.
- **Keeping times:** a `DropPreview` may carry `shiftMs`, the shift the drop would really make. The ghost is drawn there and the "move" intent carries it, so a host can keep a bar's times on some rows however far it was dragged along (the demo does for its No stand lane).
- **Several drags at once:** each pointer drags on its own, so several bars can be dragged at the same time (Skye's helper cursors do). Only the primary pointer scrolls the region near its edges, since one scroller cannot follow several pointers.
- **Pinned rows (optional):** pass `pinnedRows` and they are drawn in their own strip under the top ruler, with their own labels and plot. With the rows scrolling (`maxHeight` or `fillHeight`), the strip stays in view while `rows` scroll beneath it. `occupancies` holds the bars for both; each goes on the row its `rowId` names. Bars are selected and dragged on pinned rows as on any others, and between them and the other rows: the drag's ghost is drawn in whichever strip it lands in. Over the pinned rows a drag does not scroll up, since they are somewhere to drop. Layers render once per strip. `useTimeline().section` says which (`"pinned"` or `"body"`), and `rows`, `bars` and `plotHeight` are that strip's; `allBars` holds both. A layer that should draw once (SVG `<defs>`, say) checks `section`. What a pinned row means is the host's decision; the demo app uses one for flights waiting for a stand.
- **Where rows show:** `rowsViewport(scroller, section?)` returns where a strip's rows show on screen now: for the body, below the top ruler and pinned rows and above the bottom ruler; for `"pinned"`, the pinned strip. Both exclude the row labels. `sectionOf(element)` says which strip an element is in. Use them, not the rulers' boxes, to tell whether a bar shows or to aim at one.
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
   - A slot can instead carry host HTML in `html` (e.g. a design-system tag), drawn in a `<foreignObject>` of the given `height` in place of its text and icons. It fits as `primary` plus `padding` px, so HTML with no text (e.g. a picture) may leave `primary` empty, and is left out, never truncated, when it does not fit.
   - A slot can list `narrower` forms of itself, widest first (e.g. the same tag with fewer parts). When it is the lowest-priority slot shown and does not fit, each form is tried before the slot is left out.
   - Bars are rounded rectangles unless `barEnds` shapes their ends (see [Bar shapes](#bar-shapes)). Clipping at the window edge is described in text through `describeClipping(bar)`.
   - Slots never overlap, and each is clipped to its own width. Full details belong in `describe`, which supplies the accessible name. Bars have no hover tooltip; the host shows details on selection. Its `:hover` styles also apply to `[data-agent-hover]`, for a scripted pointer, which no script can give `:hover`.
   - Labels are their own layer, above every bar, so CSS can't reach them from their bar. Each bar's labels are a `.st-bar-labels` group instead, marked `--selected`, `--linked`, `--hovered` (under a pointer: a person's, or any of several scripted ones at once, each by its pointer id) or `--focused` (keyboard focus) as its bar is, plus any classes `BarLabels.className` returns, so a host can style them by their bar's state.
2. **`renderBar`:** replaces a bar's visuals. The chart keeps focus, click handling and the selection outline.
3. **Custom layers:** call `useTimeline()` and `useTimelineRegion()` to draw in the shared coordinate space.

## Bar shapes

`barRadius` (3px by default) rounds the bars' corners. `barEnds={(occupancy) => ({ start, end })}` shapes each end: `"round"` (the default), `"taper"` (to a point at mid-height) or `"zigzag"`. What a shape means is the host's choice; the demo zigzags a tow's end in both its flight styles, and tapers a flight's in classic. The shapes scale with the bar's height and never reach past its middle. An end cut off at the window's edge is drawn round, since what it marks is out of view. The chart resolves both into `bar.ends`.

Everything drawn in a bar's shape follows it: the bar, its selection outline (grown 1.5px all round, with parallel edges), its backdrop, the drop ghost and the cut-out under a delay ghost. Labels keep `BarLabels.padding` (5px by default) in from where a shaped end begins, as from a round end. To draw the same shape elsewhere at any size (a card, say), use `barPath(box, ends, radius, outset?)`, which returns an SVG path.

## Bar link

`<BarLink fromId toId />` draws a dashed elbow connector from one bar to another, and the dashes flow toward `toId`. Place it after the bars so it draws on top. The host decides when to show it, for example a pending swap between two selected stays, and can pass a `className` that sets `--st-link` to show a status. The link is decorative, so the host must also state the relationship in text. It is hidden when either bar is outside the visible window, and it stops animating under `prefers-reduced-motion`.

## Bar backdrop

`<BarBackdrop blur={20}><TimeGrid /></BarBackdrop>` gives the bars a frosted-glass backdrop, as CSS `backdrop-filter: blur()` would give an HTML element; SVG elements have none. The wrapped layers draw sharp except under the bars, where a copy blurred by `blur` px shows instead, clipped to each bar's shape. `saturate` (1 by default, as CSS `saturate()`) also saturates what shows through, as acrylic glass does; greys stay grey. Place it where those layers would go, before `OccupancyBars`, and give the bars a translucent fill (`BarStyle.fillOpacity`) so the blur shows through. The children render twice, so any ids they carry must be their own (`useId`), and they must not be interactive.

## Bar ghosts

`<BarGhosts ghosts={(bar, formatTime) => …} />` draws see-through, dashed extensions of bars, for example how late an aircraft reaches or leaves its stand. Each `BarGhost` reaches `ms` back from the bar's start (`side: "start"`) or on from its end (`side: "end"`), in the bar's `color` (`--st-ghost` by default). It is joined to its bar: there is no gap or outline where they meet, and it fills in beside the bar's end, whatever its shape, so the bar and its ghost read as one shape. This assumes bars are drawn in `DefaultBar`'s shape. Hovering a ghost shows its `label` in a pill, and clicking it selects its bar.

- **Clashes:** the host sets `clash` to draw a ghost red (`--st-ghost-clash`), for example where it runs into another bar. The chart does not check overlaps itself.
- **Placement:** place it after the bars and labels, so a clashing ghost shows over the bar it runs into.
- **Text:** ghosts are decorative, so the host's `describe` must also state them.

## Rulers and gutter

- **Ruler placement:** `axes` (`"top"` by default, or `"bottom"` or `"both"`) decides which rulers the root lays out. Add one `<TimeAxis position="top" | "bottom" />` for each enabled ruler. Both rulers use the same scale and scroll container, so their ticks line up.
- **Fade:** `fade` drops the bottom ruler (whatever `axes` says) and masks the body's rows (their labels and plot) so they fade to transparent towards the chart's lower edge, over any host surface. The fade length is `--st-fade-size` (64px by default), and the scrollbars stay opaque. The fade only shows while rows continue below the visible area: it eases out over the last `--st-fade-size` of scrolling and is absent when nothing overflows (including when neither `maxHeight` nor `fillHeight` is set).
- **Frosted pinned surfaces:** the rulers' axes, the corners, the row labels and the pinned rows' plot each frost what scrolls beneath them (`--st-pinned-bg` over `--st-pinned-backdrop`). Chromium blurs nothing for a `backdrop-filter` inside an element that is masked or has its own `backdrop-filter`. So the chart sets neither on any ancestor of those surfaces, and a host must not either. If a host surface around the chart needs glass, draw it on a layer behind the chart, such as a `::before`, not on an element that contains it.
- **Tick labels:** `format` may return a string, `{ text, anchor }` to set the anchor per tick (`"start"`, `"middle"` or `"end"`, offset from the tick by `labelOffset`), or null for a tick with no label.
- **Label collisions:** when labels would overlap, those with higher `labelPriority` win and the others are dropped. Labels never move off their timestamp.
- **Tick lengths:** short ticks point toward the plot. Ticks on multiples of `majorMs` run the full height of the ruler.
- **Stand gutter:** `StandRows` accepts `labelAlign="end"` for right-aligned IDs, `showGroup={false}` to hide group names, and `title={null}`. A `row.group` change still draws a divider across both the gutter and the plot.

## Zoom

`const zoom = useTimelineZoom({ initialHourWidth, maxHourWidth })`, passed as `<StandTimeline zoom={zoom}>`, zooms the time axis. Only time stretches or shrinks; rows keep their height.

- **Gesture:** pinching a trackpad over the chart zooms it about the pointer, keeping the time under the pointer where it is. Chromium delivers a pinch as wheel events with `ctrlKey` set, so Ctrl (or ⌘) + a mouse wheel zooms too, and the page itself is kept from zooming. Plain scrolling still pans.
- **Bounds:** the plot is drawn at `zoom.hourWidth` pixels per hour, from `fitHourWidth` (the whole domain across the visible plot, as far out as it goes) up to `maxHourWidth`. Zoomed all the way out, it stays fitted as the chart resizes. With `zoom`, `minHourWidth` is ignored.
- **Host controls:** the zoom is the host's, so its own controls (a slider, buttons) can sit anywhere on the page. `zoomTo(hourWidth)`, `zoomBy(factor)` and `fit()` zoom about the middle of the visible plot. `fitted` and `visibleMs` (how much time the visible plot shows) describe the current zoom. The chart stays free of design-system components; the demo's controls are a row in its View menu, `stand-timeline-demo/ZoomMenuRow.tsx`.
- **Rulers:** pick a `TimeAxis` step to suit `zoom.hourWidth`. Labels that would collide are dropped as usual (the demo adds 5-minute ticks when zoomed far in; see `rulerFor` in `theme.tsx`).

## Not yet included

Resize, virtualization, overlap lanes and conflict overlays.
