/**
 * Inline copy of `media/hooman.svg`: rendered as JSX (not an `<img>`) so
 * `currentColor` inherits the theme's foreground/accent instead of defaulting
 * to black inside an image document.
 */
export default function HoomanLogo(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      fill="none"
      stroke="currentColor"
      stroke-width="18"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
    >
      <rect x="48" y="92" width="160" height="140" rx="32" />
      <line x1="128" y1="46" x2="128" y2="92" />
      <circle cx="128" cy="28" r="13" fill="currentColor" />
      <line x1="30" y1="150" x2="30" y2="174" />
      <line x1="226" y1="150" x2="226" y2="174" />
      <rect
        x="86"
        y="138"
        width="21"
        height="40"
        rx="10.5"
        fill="currentColor"
        stroke="none"
      />
      <path d="M173 142 147 158l26 16" />
    </svg>
  );
}
