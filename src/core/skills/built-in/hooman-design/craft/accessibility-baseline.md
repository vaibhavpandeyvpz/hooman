# Accessibility baseline

Target **WCAG 2.2 AA** as the working floor.

## Contrast

| Pair                                | Minimum |
| ----------------------------------- | ------- |
| Normal text                         | 4.5:1   |
| Large text (≥24 px / ≥18.5 px bold) | 3:1     |
| UI components / graphics            | 3:1     |
| Focus vs adjacent                   | 3:1     |

## Structure

- One `h1` per view; heading levels do not skip
- Buttons are `<button>`; links are `<a href>`
- Form controls have visible labels (`<label for>`)
- Images that convey meaning have `alt`; decorative images `alt=""`
- Focus visible on all interactive controls; do not remove outlines without a replacement

## Interaction

- Hit targets ≥24×24 px (prefer 44×44 on touch)
- Do not rely on color alone for status
- Motion: respect `prefers-reduced-motion`
- Keyboard: all primary actions reachable without a pointer

## Language

- Set `<html lang="...">`
- Error text names the field and how to fix it
