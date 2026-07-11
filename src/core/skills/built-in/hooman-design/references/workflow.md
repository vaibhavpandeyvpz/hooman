# Design workflow (strict)

Follow these phases **in order** for every new brief. Do not skip ahead to writing HTML. Use `ask_user` for each decision (one question per call). Users can always type a free-form answer; still offer concrete choices.

## Phase 0 — Activate

If `hooman-design` is not active, activate it before any design write.

## Phase 1 — Intake (what they already have)

Ask what starting material they have. Recommended options (adapt labels; keep ≤6):

1. Brand / `DESIGN.md` notes only
2. Nothing — start fresh from a template
3. Reference images / screenshots to recreate in HTML
4. Mix / other (I'll describe)

**`DESIGN.md`:** If a `DESIGN.md` is already injected in the system prompt, say so and do **not** ask whether one exists — ask only whether to honor it as-is or override for this artifact. If none is injected, include an option or follow-up to capture brand tokens / write guidance into the brief (do not invent a parallel brand file unless the user asks).

## Phase 2 — Clarify the brief

Ask focused follow-ups until you can name: audience, surface (landing / deck / dashboard / form / …), must-have sections or slides, tone, and hard constraints (print size, dark-only, no stock photos, …). Prefer 1–3 `ask_user` rounds over guessing. Do **not** write HTML until this is clear enough to pick a shell.

## Phase 3 — Template (shell)

From the shells table in `SKILL.md`, pick the **5 best-fit** shells for this brief (recommended first). Offer them via `ask_user` plus a 6th option: **Other / custom (I'll describe)**.

Read the chosen shell HTML under `assets/` before building. Only invent structure from scratch when they choose Other / custom.

## Phase 4 — Color theme (direction)

- If `DESIGN.md` is in force: skip picking a library direction; bind to those tokens.
- Otherwise: from `directions.md`, offer the **5 best-fit** direction ids (recommended first) plus **Other / custom (I'll describe)**. Copy matching `assets/tokens/<id>.css` into the artifact `:root` when they pick a library direction.

State the chosen shell + direction (or DESIGN.md) in chat in one short line, then build.

## Phase 5 — Build

Write only under `.hooman/design/<slug>/` (`index.html` + optional `assets/`). Prefer the shell + tokens.

## Phase 6 — Preview + internal visual QA

After the first meaningful HTML write (and after each Must-fix round):

1. `preview_design` on the entry (keep this running — do **not** stop yet)
2. `export_design` `format: "images"`
3. `launch_subagent` `kind: "design-review"` (binary-read every shot)
4. Fix Must-fix → re-capture → re-review (max 2–3 rounds)

Do **not** call delivery export formats until Must-fix is empty or you hit the round cap and report remaining issues honestly.

## Phase 7 — Human review

When internal QA is clear (or capped), **ask the user** to look at the live preview and give feedback. Options like: Looks good — export / Needs changes (I'll describe) / Start over.

Iterate Phases 5–7 on feedback. Keep the preview open across iterations (hot reload).

## Phase 8 — Export format

Only after the user confirms the design is good enough, ask which delivery format(s) they want. Offer the best-fit set for the surface, e.g.:

1. Figma Design (`.fig`) — screenshot-backed
2. Figma Slides (`.deck`) — prefer for `[data-slide]` decks; screenshot-backed
3. Sketch (`.sketch`) — screenshot-backed
4. PDF
5. PowerPoint (`.pptx`)
6. Other / multiple (I'll describe)

Then call `export_design` with the chosen delivery `format`(s). See `export.md`.

## Phase 9 — Stop preview

Call `stop_design_preview` with the same HTML path **only after** delivery export finishes (or the user explicitly declines export / ends the session without exporting). Never stop preview before export when the user asked to ship a file.

## Shortcuts that are forbidden

- Writing HTML before intake + clarify + template (+ theme when no DESIGN.md)
- Auto-picking a direction without asking when no DESIGN.md applies
- Capturing screenshots then exporting / finishing without `launch_subagent` (`kind: "design-review"`)
- Stopping preview before delivery export when export was requested
