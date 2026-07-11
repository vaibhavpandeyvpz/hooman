# Spacing and density craft rules

Spacing is a system, not one-off margins.

## Scale

Prefer a 4 px base. Expose tokens in `:root`:

| Token       | Default | Use                           |
| ----------- | ------- | ----------------------------- |
| `--space-1` | 4px     | Hairline tweaks               |
| `--space-2` | 8px     | Icon gaps, compact stacks     |
| `--space-3` | 12px    | Related control groups        |
| `--space-4` | 16px    | Default component padding     |
| `--space-5` | 24px    | Section padding (compact)     |
| `--space-6` | 32px    | Section padding (comfortable) |
| `--space-7` | 48px    | Major section breaks          |
| `--space-8` | 64px    | Hero / slide outer padding    |

## Density postures

| Posture         | When                        | Notes                                               |
| --------------- | --------------------------- | --------------------------------------------------- |
| **Comfortable** | Marketing, editorial, decks | Larger type, `--space-6`+ section gaps              |
| **Standard**    | Product UI, settings        | `--space-4` / `--space-5`                           |
| **Dense**       | Tables, consoles, ops       | `--space-2` / `--space-3`; never starve hit targets |

Pick one posture per artifact. Do not mix hero-airy with table-cramped in the same view without a clear region boundary.

## Stacking

- Vertical rhythm: consistent gap between siblings (`gap` on flex/grid > random margins)
- Related items closer than unrelated (proximity)
- Separate regions with space **or** a hairline — not both stacked heavily

## Cards and lists

- Internal padding ≥ `--space-4` on all sides unless dense table cells
- Gap between cards ≥ internal padding (avoid “tile wallpaper”)
- List rows: align baselines; meta column must not collide with primary text

## Anti-patterns

- `margin: 10px 15px 8px 12px` snowflake values
- Huge hero padding + cramped footer on the same slide
- Nested cards each adding full padding until content is a postage stamp
