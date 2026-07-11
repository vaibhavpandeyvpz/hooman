# Motion craft rules

Motion supports hierarchy; it is not decoration.

## Defaults

- Duration: 120–200 ms for UI chrome; 200–320 ms for larger layout shifts
- Easing: `cubic-bezier(0.2, 0.8, 0.2, 1)` or `ease-out` — avoid bounce/elastic on product UI
- Prefer opacity + transform (`translate` / `scale`) over layout-thrashing properties

## Must respect

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

## Allowed

- Focus / hover state transitions on controls
- Subtle enter for toasts, dialogs, drawers
- Progress indicators that communicate wait time

## Avoid

- Continuous decorative loops (floating blobs, shimmer forever on static marketing)
- Parallax that fights scroll reading
- Auto-playing carousels without pause/controls
- Motion as the only way to notice a state change

## Decks

Keep slide transitions minimal or none in HTML preview (scroll / snap is enough). Export screenshots are static — do not rely on animation to hide overflow.
