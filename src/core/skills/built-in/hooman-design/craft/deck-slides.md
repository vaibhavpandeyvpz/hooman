# Deck / slide craft rules

For HTML decks under `.hooman/design/<slug>/` with `[data-slide]`.

## Frame

- Each slide is a **fixed frame**: typically `width: 100vw; height: 100vh` (or 1280×720 logical for export fidelity)
- Content lives in an inner stack with **safe padding** (≥ 6–8% of the short side, or `--space-7` / `--space-8`)
- Use `display: flex; flex-direction: column;` on the slide; put scrollable regions only inside a designated body that still fits the frame

## Chrome

Reserve bands so body copy never collides:

| Band   | Typical content                                     |
| ------ | --------------------------------------------------- |
| Top    | Section kicker, confidentiality, logo wordmark      |
| Body   | Title, lede, cards/grid                             |
| Bottom | Source line, slide index `03 / 08`, footer wordmark |

Bottom chrome height is sacred — titles and cards must clear it.

## One job per slide

- One headline idea; supporting copy ≤ ~2 short paragraphs or a tight list
- Prefer 2–3 cards over 6 cramped tiles
- If content does not fit after type/spacing pass: **split the slide**

## Type on slides

- Display titles: `clamp()` with a **max** that still fits with chrome (often ≤ ~3.2rem at 720p-class frames)
- Body on slides often 15–18 px; avoid marketing-site 24 px body inside a fixed frame
- ALL CAPS kickers: tracking `0.08em`+

## Capture / export

- Mark every slide root `[data-slide]`
- Run `export_design` (`format: "images"`) → `launch_subagent` (`kind: "design-review"`, binary) before delivery `export_design` (`pdf` / `images-to-pdf` / `pptx` / `figma` / `figma-deck` / `sketch`)
- Prefer `figma-deck` when the handoff is Figma Slides; `sketch` when the handoff is Sketch; PDF/PPTX when the handoff is print/share-only. All of `figma` / `figma-deck` / `sketch` / `pptx` are screenshot-backed.
- Fix P0 overflow/overlap before calling export

## Anti-patterns

- Long scrolling “slides” that are really pages (breaks PPTX pagination)
- Absolute-positioned footers over flex content without padding-bottom compensation
- Decorative full-bleed images that crush text contrast
