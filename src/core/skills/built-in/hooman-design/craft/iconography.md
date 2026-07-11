# Iconography craft rules

Icons support meaning; they are not decoration filler.

## Rules

1. **One system per artifact** — monoline SVG with `currentColor`, consistent viewBox (prefer `0 0 24 24`), 1.5–2 px stroke.
2. **No emoji as icons** — see `anti-ai-slop.md`.
3. **Optical size** — UI icons 16–20 px; marketing feature icons 24–32 px; never mix scales in one row without intent.
4. **Align to type** — center icons on the text cap-height of adjacent labels; use flex `align-items: center` + gap from the spacing scale.
5. **Accessible name** — decorative icons: `aria-hidden="true"`. Meaningful icons without visible text: `aria-label` on the control.
6. **Touch** — icon-only buttons still need ≥24×24 px hit target (prefer 44×44 on touch).

## Anti-patterns

- Random Lucide + Heroicons + emoji in one screen
- Filled + outlined mixed without hierarchy
- Colored icons that fail contrast on the surface
- Icon grids of 6+ “features” with generic metaphors (rocket, lightning, target)
