# Data visualization craft rules

Charts exist to answer a question — not to decorate a dashboard.

## Must

1. **Real or labelled data** — if numbers are placeholders, mark them (`Sample`, `Fixture`) — never invent “+340% MoM”.
2. **One question per chart** — title states the takeaway.
3. **Axes and units** — labelled; don’t hide scale tricks.
4. **Color** — categorical ≤ 5–6 hues from the direction palette; sequential for magnitude; never rainbow defaults.
5. **Non-color cues** — pattern, labels, or shape when status matters (a11y).

## Prefer

- Simple bar / line / sparklines over 3D, donut stacks, or dual-axis confusion
- Tables when precision > trend
- Empty and loading treatments for chart panels (`state-coverage.md`)

## Avoid

- Chart.js / Recharts defaults with purple fills when the direction forbids them
- Pie charts with >4 slices
- Animating every redraw
- Dashboards that are only charts with no written insight
