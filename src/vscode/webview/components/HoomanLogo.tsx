/**
 * Inline copy of `media/icon.svg`: rendered as JSX (not an `<img>`) so
 * `currentColor` inherits the theme's foreground/accent instead of defaulting
 * to black inside an image document.
 */
export default function HoomanLogo(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      class={props.class}
    >
      <defs>
        <mask id="hooman-face-hole" maskUnits="userSpaceOnUse">
          <rect width="256" height="256" fill="white" />
          <rect x="58" y="86" width="140" height="116" rx="24" fill="black" />
        </mask>
      </defs>
      <g fill="currentColor" mask="url(#hooman-face-hole)">
        <rect x="18" y="118" width="26" height="52" rx="13" />
        <rect x="212" y="118" width="26" height="52" rx="13" />
        <rect x="122" y="38" width="12" height="44" rx="6" />
        <rect x="40" y="68" width="176" height="152" rx="36" />
      </g>
      <rect x="85" y="122" width="22" height="44" rx="11" fill="currentColor" />
      <path
        d="M172 128 146 144l26 16"
        fill="none"
        stroke="currentColor"
        stroke-width="18"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="83" cy="178" r="9" fill="currentColor" opacity="0.45" />
      <circle cx="173" cy="178" r="9" fill="currentColor" opacity="0.45" />
      <circle cx="128" cy="38" r="11" fill="currentColor" />
    </svg>
  );
}
