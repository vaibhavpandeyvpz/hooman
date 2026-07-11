# Responsive craft rules

Design for a primary viewport, then prove the critical breakpoints.

## Breakpoints (suggested)

| Name | Width   | Use                                       |
| ---- | ------- | ----------------------------------------- |
| `sm` | ≥640px  | Comfortable phone landscape / large phone |
| `md` | ≥768px  | Tablet / split nav                        |
| `lg` | ≥1024px | Desktop shell                             |
| `xl` | ≥1280px | Wide marketing / dashboards               |

Pick **one** primary (usually `lg` for product, `sm` for mobile-frame shells) and test one step down.

## Patterns

- Fluid type with `clamp()` for display; fixed steps for dense UI
- Grid → single column before cards crush (`minmax(0, 1fr)` + `min-width: 0`)
- Nav: collapse to disclosure / bottom bar rather than microscopic links
- Decks: fixed `[data-slide]` frames are **not** responsive documents — design at capture size (e.g. 1280×720); don’t pretend mobile reflow

## Touch vs pointer

- Comfortable hit targets on small viewports
- Hover-only affordances need a non-hover equivalent

## Check

Before capture on multi-breakpoint prototypes, resize once to the secondary width and fix overflow — then re-capture the primary.
