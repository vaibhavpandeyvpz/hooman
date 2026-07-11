# Typography craft rules

`DESIGN.md` / directions choose fonts; this file governs behavior.

## Prefer Google Fonts (webfonts)

For HTML artifacts that will export to **Sketch** (and for consistent preview across machines), load display/body faces from [Google Fonts](https://fonts.google.com/) instead of relying on system-only stacks:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&display=swap"
  rel="stylesheet"
/>
<style>
  :root {
    --font-display: "Source Serif 4", Georgia, ui-serif, serif;
    --font-body: Inter, system-ui, sans-serif;
  }
</style>
```

Why:

- Preview and Playwright measure use the same faces
- `export_design` `format: "sketch"` **embeds** document `@font-face` / Google Fonts TTFs into the `.sketch` (`fontReferences`) so collaborators see correct type without installing fonts
- System fonts (Georgia, SF Pro, …) are **not** scraped from disk — keep them only as fallbacks after a webfont

Rules:

- Max 2 families; load only weights you use (400/600/700 typical)
- Self-host under `assets/fonts/` is fine if you ship `@font-face` with `.ttf` / `.otf` (WOFF2 alone will not embed in Sketch)
- Do not invent proprietary font names without a real `@font-face` or Google link

## Type scale

Use a multiplicative scale (1.2–1.25). Cap at 6–8 sizes.

| Role    | Range    |
| ------- | -------- |
| Display | 48–72 px |
| H1      | 32–48 px |
| H2      | 24–32 px |
| H3      | 20–24 px |
| Body    | 15–18 px |
| Small   | 13–14 px |
| Caption | 11–12 px |

## Line height

| Text size             | Line height |
| --------------------- | ----------- |
| Display / H1 (≥32 px) | `1.0`–`1.2` |
| Body (15–18 px)       | `1.5`–`1.6` |
| Small (≤14 px)        | `1.5`       |

## Letter-spacing

| Context             | Letter-spacing                  |
| ------------------- | ------------------------------- |
| Body 14–18 px       | `0`                             |
| Small 11–13 px      | `0.01em`–`0.02em`               |
| UI labels / buttons | `0.02em`                        |
| **ALL CAPS**        | **`0.06em`–`0.1em` (required)** |
| Headings 32 px+     | `-0.01em`–`-0.02em`             |
| Display 48 px+      | `-0.02em`–`-0.03em`             |

## Pairing

- Max 2 typefaces per artifact
- Do not set body below 15 px for long reading
- Prefer `clamp()` for display on responsive prototypes
