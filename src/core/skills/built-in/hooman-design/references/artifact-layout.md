# Artifact layout

Write design artifacts only under:

```
.hooman/design/<slug>/
  index.html     # required entry
  assets/        # optional images, fonts, copied tokens
  reviews/       # screenshots from export_design format:images (visual QA)
  export/        # optional PDF / PPTX / screenshot-backed .fig / .deck / .sketch
```

- `<slug>` is kebab-case from the brief (reuse the same slug when refining).
- Do not invent parallel trees outside `.hooman/design/<slug>/`.
- Delivery exports (`pdf` / `images-to-pdf` / `pptx` / `figma` / `figma-deck` / `sketch`) land under `export/` by default.
