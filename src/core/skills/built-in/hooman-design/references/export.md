# Export

Use the built-in tool (do not hand-roll PDF/PPTX/Figma/Sketch with shell):

- `export_design` with `format`:
  - `images` — page screenshots under `reviews/` by default (visual QA; then `launch_subagent` with `kind: "design-review"`)
  - `pdf` — Chromium print PDF under `export/`
  - `images-to-pdf` — screenshot pages stitched into a PDF under `export/`
  - `pptx` — screenshot-backed PPTX under `export/`
  - `figma` — screenshot-backed Figma Design `.fig` under `export/` (one image frame per page)
  - `figma-deck` — screenshot-backed Figma Slides `.deck` under `export/` (one image slide per page)
  - `sketch` — screenshot-backed Sketch `.sketch` under `export/` (one image artboard per page)

## Gate: visual QA + human go-ahead first

Do **not** call delivery formats (`pdf` / `images-to-pdf` / `pptx` / `figma` / `figma-deck` / `sketch`) until:

1. `export_design` with `format: "images"` has written current `reviews/` shots, and
2. `launch_subagent` with `kind: "design-review"` has run with those shot paths (binary reads), and
3. Must-fix is empty — or you hit the 2–3 round cap and will report remaining Must-fix to the user, and
4. The user has accepted the live preview (or explicitly asked to export anyway) and chosen a delivery format via `ask_user` (see `workflow.md` phases 7–8).

Keep `preview_design` running until after delivery export, then `stop_design_preview`.

Capturing screenshots and then delivering without review is a process failure.

## When

- User asks for PDF/PPTX, Figma (`.fig` / `.deck`), Sketch (`.sketch`), or
- Delivering a deck / printable one-pager / design-tool handoff as the deliverable
- **and** the gate above is satisfied

## Deck convention

Mark each slide root with `data-slide` so export paginates correctly:

```html
<section data-slide>...</section>
```

Without `data-slide`, export treats the document as a long page (PDF multipage / single PPTX slide or paginated viewports). For `figma` / `figma-deck` / `sketch` / `pptx`, each `[data-slide]` becomes one screenshot page/slide/frame/artboard.

## Notes

- First PDF/PPTX/`images` / Figma / Sketch export may need Playwright Chromium (`npx playwright install chromium`).
- `pptx`, `images-to-pdf`, `images`, `figma`, `figma-deck`, and `sketch` are all **screenshot-backed** (visual fidelity). They are not native editable layer trees — open them in the target app as flat image frames/slides/artboards, like a PPTX built from screenshots.
- Prefer `figma-deck` for `[data-slide]` decks when the handoff is Figma Slides; prefer `figma` for multi-frame Design files; prefer `sketch` when the handoff is Sketch; prefer `pptx` for PowerPoint.
