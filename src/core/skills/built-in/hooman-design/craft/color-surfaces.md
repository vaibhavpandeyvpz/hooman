# Color and surfaces craft rules

`DESIGN.md` / directions own the palette. This file governs how surfaces behave.

## Roles (name them in `:root`)

| Role                                   | Purpose                                                  |
| -------------------------------------- | -------------------------------------------------------- |
| `--bg`                                 | Page / slide canvas                                      |
| `--surface`                            | Raised panel / card                                      |
| `--surface-2`                          | Nested elevation (use sparingly)                         |
| `--ink`                                | Primary text                                             |
| `--muted`                              | Secondary text (still ≥ 4.5:1 on `--bg` / `--surface`)   |
| `--border`                             | Hairlines, dividers                                      |
| `--accent`                             | Primary action / sparse emphasis                         |
| `--accent-soft`                        | Tinted chip / selected row / soft badge fill             |
| `--accent-ink`                         | Text/icon on solid `--accent`                            |
| `--danger` / `--success` / `--warning` | Status only                                              |
| `--focus`                              | Focus ring / outline (often matches accent)              |
| `--overlay`                            | Modal / dialog scrim                                     |
| `--shadow`                             | Optional elevation (`none` when borders carry structure) |
| `--leading-body` / `--tracking-caps`   | Body leading + ALL CAPS tracking                         |
| `--text-body` / `--text-small`         | Default body / small sizes                               |

## Rules

1. **Flat first** — prefer solid fills over gradients. If a gradient exists, one subtle stop pair max, never as the only brand signal.
2. **Accent budget** — ~2 strong accent moments per screen/slide (CTA + one highlight). Links can use a quieter tint.
3. **Borders over shadows** for structure in product UI; soft shadows only when elevation must read on a busy canvas.
4. **No raw hex sprawl** — new colors go in `:root`; components reference tokens.
5. **Dark surfaces** — raise with border + slight luminance step, not heavy white glow.
6. **Status color** — pair with icon or label; never color alone.

## Contrast quick checks

- Body on `--bg` / `--surface`: ≥ 4.5:1
- Muted text: still readable; if it fails, lighten/darken `--muted`, don’t shrink type to “fix” it
- Accent-on-accent text (e.g. white on teal): verify large and small sizes

## Anti-patterns

- Purple/indigo default stacks when direction specifies otherwise
- Glassmorphism stacks (blur + translucency + border + shadow)
- Every card a different pastel wash
- Light gray text on colored badges that fails AA
