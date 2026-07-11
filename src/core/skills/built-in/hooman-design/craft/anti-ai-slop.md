# Anti-AI-slop rules

Concrete rules that distinguish shipped product design from default LLM output.

## Must-fix (P0)

1. **Default Tailwind indigo as accent** — `#6366f1`, `#4f46e5`, `#4338ca`, `#3730a3`, `#8b5cf6`, `#7c3aed`, `#a855f7`. Use `DESIGN.md` / direction accent instead.
2. **Two-stop "trust" gradient on the hero** — purple→blue, blue→cyan, indigo→pink. Prefer flat surfaces + intentional type.
3. **Emoji as feature icons** — no `✨` `🚀` `🎯` `⚡` `🔥` `💡` as icons. Use monoline SVG with `currentColor`.
4. **Generic Inter/Roboto display when a direction binds a serif** — honor `--font-display`.
5. **Rounded card + colored left-border accent** — the canonical AI dashboard tile. Drop radius or the left border.
6. **Invented metrics** — "10× faster", "99.9% uptime". Use real numbers or labelled placeholders.
7. **Filler copy** — `lorem ipsum`, `feature one / two / three`, `placeholder text`.

## Should-fix (P1)

- Stock Unsplash / placehold.co / picsum heroes
- More than ~12 raw hex values outside `:root`
- Accent color used 6+ times on one screen (cap ~2 visible uses)
- Identical "Hero → Features → Pricing → FAQ → CTA" with no variation

## Polish (P2)

- Decorative blob / wave backgrounds with no meaning
- Perfect symmetry with no visual tension — vary density across sections

Aim for ~80% proven patterns + ~20% distinctive choice (one bold type/color move, specific microcopy, one memorable micro-interaction).
