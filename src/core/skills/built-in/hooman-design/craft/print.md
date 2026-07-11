# Print craft rules

For one-pagers, handouts, and PDF via print CSS (not only screenshot PDF).

## Setup

```css
@page {
  size: A4;
  margin: 16mm;
}
@media print {
  .no-print {
    display: none !important;
  }
  a[href]::after {
    content: none; /* or show URL deliberately */
  }
  body {
    background: #fff;
    color: #000;
  }
}
```

## Rules

1. **Ink-friendly** — flat blacks/grays; avoid large dark fills that waste toner unless brand requires it.
2. **Page breaks** — `break-inside: avoid` on cards/figures; keep heading with following paragraph.
3. **Hide chrome** — nav, sticky CTAs, cookie banners: `.no-print`.
4. **Links** — either visible URL footnotes or clean text; don’t dump raw URLs after every word.
5. **Decks** — prefer `export_design` with `format: "images-to-pdf"` or `"pptx"` for print/share, or `format: "figma-deck"` / `"sketch"` / `"figma"` for screenshot-backed Figma/Sketch handoffs; `format: "pdf"` (Chromium print) is for document-like HTML.
6. **Print shells** — start from `resume-shell`, `business-card-shell`, `invite-shell`, or `flyer-shell` when the brief is a CV, card, invite, or handout.

## Check

Print-preview once (or export) before calling the artifact done when the deliverable is a PDF handout.
