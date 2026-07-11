# Layout overflow craft rules

Visual QA exists because source review cannot see these failures. Treat them as **P0 Must-fix**.

## Must-fix (P0)

1. **Text clipped by a fixed box** — descenders or last lines cut at `overflow: hidden`, card bottoms, or slide edges.
2. **Overlapping layers** — headings through footers, body through badges, counters through copy, absolute chrome over content.
3. **Fixed slide / viewport height with unbounded content** — `[data-slide]` at `100vh` / `100dvh` must fit **all** content with padding; shrink type, reduce blocks, or split slides — never let content spill.
4. **Insufficient padding to chrome** — content closer than ~24–32 px to slide header, footer, or page counter.
5. **Flex/grid children that cannot shrink** — long words / URLs without `overflow-wrap` / `min-width: 0`.

## Should-fix (P1)

- Cards with uneven internal padding (cramped bottom, airy top)
- Multi-column rows where one cell wraps into another’s badge/meta
- Sticky headers that cover focused content when scrolled
- `line-clamp` without a real truncation strategy (tooltip / expand)

## Deck / fixed-frame checklist

Before capture:

- [ ] Every `[data-slide]` content fits inside padding box at target viewport (default 1280×720 capture)
- [ ] Footer / kicker / `01 / 08` never intersect body type
- [ ] Card grids use consistent gaps; no badge-on-text collisions
- [ ] Large display type has room for descenders + next element

## After capture

Read every `reviews/*.png` with `binary: true`. If any P0 appears, fix CSS/structure and re-capture — do not export.
