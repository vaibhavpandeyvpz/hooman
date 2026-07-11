---
name: hooman-design
description: Required playbook for design work — activate in design mode (or whenever producing HTML prototypes, dashboards, or decks). Covers the strict discovery→template→theme→build→preview→QA→human review→export workflow, DESIGN.md / directions, craft rules, artifact layout under .hooman/design, and delivery export (PDF/PPTX/screenshot-backed .fig/.deck/.sketch).
---

# Hooman Design

Act like a senior product designer who ships real CSS: clear hierarchy, intentional type, brand-faithful color, and no AI-slop defaults.

## Strict workflow

**Follow `references/workflow.md` in order for every new brief.** Summary:

| Phase | Do                                                                                                            | Gate                                            |
| ----- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 0     | Activate this skill                                                                                           | Before any write                                |
| 1     | Intake via `ask_user` (brand notes / fresh / reference images / other); honor injected `DESIGN.md` when present | Brief known                                     |
| 2     | Clarify audience, surface, content, constraints                                                               | Enough to pick a shell                          |
| 3     | Offer **5 best-fit shells** + **Other / custom**                                                              | Shell chosen; read its HTML                     |
| 4     | Theme: use `DESIGN.md`, else **5 best-fit directions** + **Other / custom**                                   | Tokens bound                                    |
| 5     | Build under `.hooman/design/<slug>/`                                                                          | Meaningful `index.html`                         |
| 6     | `preview_design` (keep open) → images → `design-review` → fix (≤2–3 rounds)                                   | Must-fix empty or capped                        |
| 7     | Ask user to review the live preview                                                                           | User accepts or requests changes                |
| 8     | Ask export format → `export_design` delivery formats                                                          | Files under `export/`                           |
| 9     | `stop_design_preview`                                                                                         | **Only after** export (or user declines / ends) |

Do **not** write HTML before phases 1–4. Do **not** stop preview before phase 9.

## Before the first write

1. Confirm this skill is active.
2. Run phases 1–4 with `ask_user` (see `references/workflow.md`). One question per call; ≤6 options; recommended first; free-text always allowed for custom.
3. Read craft siblings that apply (at least):
   - `craft/anti-ai-slop.md`
   - `craft/typography.md`
   - `craft/layout-overflow.md` — **required for decks / fixed frames**
   - `craft/deck-slides.md` — **required for `[data-slide]` work**
   - `craft/spacing-density.md`
   - `craft/color-surfaces.md`
   - `craft/state-coverage.md`
   - `craft/accessibility-baseline.md`
   - plus forms / data-viz / responsive / print / motion / iconography when relevant
4. Brand: injected `DESIGN.md` wins. Else use the direction chosen in phase 4 and copy `assets/tokens/<direction>.css` into the artifact `:root`.
5. Read the chosen shell under `assets/` before inventing structure.
6. Read `references/artifact-layout.md` for the on-disk contract.

## Shells (`assets/`)

| File                       | Use when                                             |
| -------------------------- | ---------------------------------------------------- |
| `prototype-shell.html`     | Generic marketing / one-pager starting point         |
| `landing-shell.html`       | Nav + hero + feature grid + footer                   |
| `pricing-shell.html`       | 2–3 plan comparison                                  |
| `auth-shell.html`          | Sign-in / sign-up form (include error slots)         |
| `contact-shell.html`       | Contact / inquiry form (name, email, topic, message) |
| `newsletter-shell.html`    | Email subscribe strip / card                         |
| `waitlist-shell.html`      | Early-access waitlist capture                        |
| `settings-shell.html`      | Side nav + settings panel                            |
| `dashboard-shell.html`     | Ops / metrics console                                |
| `deck-shell.html`          | Slide deck with safe chrome bands (`[data-slide]`)   |
| `email-shell.html`         | Transactional email (~600px)                         |
| `empty-state-shell.html`   | Zero-data panel with primary CTA                     |
| `onboarding-shell.html`    | Multi-step wizard                                    |
| `article-shell.html`       | Long-form editorial / blog                           |
| `data-table-shell.html`    | Dense tabular ops UI                                 |
| `dialog-shell.html`        | Modal confirm / destructive action                   |
| `mobile-frame-shell.html`  | Phone-width app chrome                               |
| `resume-shell.html`        | One-page CV / resume (print-friendly)                |
| `business-card-shell.html` | Digital business card (compact contact face)         |
| `invite-shell.html`        | Event invite with when/where + RSVP                  |
| `flyer-shell.html`         | Single-sheet promo flyer / handout                   |

Direction token CSS: `assets/tokens/<id>.css` (`editorial-ink`, `swiss-grid`, `night-console`, `warm-atelier`, `fintech-clear`, `signal-mono`, `soft-product`, `harbor-navy`, `paper-mono`, `botanical-calm`, `midnight-editorial`, `copper-ledger`). See `directions.md` for posture + good-shell hints when ranking the top 5.

## Build

- Write only under `.hooman/design/<slug>/index.html` (+ optional `assets/`).
- Prefer semantic HTML + CSS variables from `DESIGN.md` / the chosen direction tokens.
- For decks, mark each slide with `data-slide` and follow `craft/deck-slides.md` + `craft/layout-overflow.md`.
- After a meaningful write, run the **full** visual QA loop — capture without review is incomplete:
  1. `preview_design` (localhost **hot-reload**; keep running through human review + export)
  2. `export_design` with `format: "images"` (writes `reviews/`)
  3. **Required next tool call:** `launch_subagent` with `kind: "design-review"` whose `query` lists every shot path and says to `read_file` each with `binary: true`
  4. Fix Must-fix (overflow / overlap / clipping first)
  5. Re-capture → re-review (max 2–3 rounds)
- Then **ask the user** to review the live preview (phase 7) before any delivery export.

## Figma / Sketch / PPTX

- **Export** — after visual QA **and** user acceptance, `export_design` with `format: "figma"`, `"figma-deck"`, `"sketch"`, or `"pptx"`.
- These formats are **screenshot-backed** (same path as PPTX): one image frame/slide/artboard per page. They are not native editable layer trees. See `references/export.md`.

## Export

- Ask which format they want (phase 8), then follow `references/export.md`.
- Delivery formats (`pdf` / `images-to-pdf` / `pptx` / `figma` / `figma-deck` / `sketch`) only after internal QA + human go-ahead.
- Call `stop_design_preview` **only after** delivery export (or the user declines export / ends the session).
