# Directions (when no DESIGN.md)

Pick **one** direction and stick to it for the artifact — but only after the user chooses it via `ask_user` (see `references/workflow.md` phase 4). When ranking options, offer the **5 best-fit** ids for the brief (recommended first) plus **Other / custom**. State the chosen id in chat. Do not invent an indigo-on-white theme outside these packs.

Copy matching tokens from `assets/tokens/<id>.css` into the artifact `:root`.

**Fonts:** Prefer [Google Fonts](https://fonts.google.com/) for `--font-display` / `--font-body` (see `craft/typography.md`) so preview, measure, and Sketch embed share the same faces. Keep Georgia / system-ui only as fallbacks after a webfont link.

## `editorial-ink`

- Posture: calm editorial product marketing
- Surfaces: near-white `#f7f5f2`, ink `#1a1a1a`
- Accent: deep teal `#0f6b6b` (max 2 visible uses per screen)
- Display: Georgia / `ui-serif`; body: system UI sans
- Avoid: gradients, purple accents, emoji icons
- Good shells: `landing-shell`, `prototype-shell`, `email-shell`, `invite-shell`, `resume-shell`

## `swiss-grid`

- Posture: dense, precise, high-contrast utility
- Surfaces: pure white `#ffffff`, black `#0a0a0a`
- Accent: signal red `#c8102e`
- Type: Inter / system sans only; tight tracking on caps (`0.08em`)
- Avoid: soft shadows, rounded mega-cards, decorative blobs
- Good shells: `settings-shell`, `pricing-shell`, `deck-shell` (light variant)

## `night-console`

- Posture: dark operational / dashboard
- Surfaces: `#0d1117`, elevated `#161b22`
- Accent: `#58a6ff`; success `#3fb950`; warning `#d29922`
- Type: system UI sans; monospace for metrics
- Avoid: neon purple, glassmorphism stacks, fake sparklines
- Good shells: `dashboard-shell`, `deck-shell` (default dark)

## `warm-atelier`

- Posture: craft / studio / portfolio
- Surfaces: warm paper `#f4efe6`, charcoal `#2c241b`
- Accent: burnt orange `#c45c26`
- Display: serif; body: humanist sans
- Avoid: cool gray chrome, stock Unsplash heroes
- Good shells: `landing-shell`, `prototype-shell`, `flyer-shell`, `invite-shell`

## `fintech-clear`

- Posture: trustworthy finance / B2B SaaS
- Surfaces: `#f8fafc`, `#ffffff`, border `#e2e8f0`
- Accent: `#0f766e` (teal); text `#0f172a`
- Type: system sans; generous body leading `1.55`
- Avoid: crypto neon, indigo Tailwind defaults, invented ROI metrics
- Good shells: `pricing-shell`, `auth-shell`, `contact-shell`, `settings-shell`

## `signal-mono`

- Posture: brutalist / launch / manifesto
- Surfaces: `#111111`, type `#fafafa`, rules `#333333`
- Accent: single electric `#ffe600` (one use per view)
- Type: condensed system sans or IBM Plex Sans; heavy weight on display
- Avoid: soft radii, pastels, illustration filler
- Good shells: `landing-shell`, `deck-shell`, `flyer-shell`, `business-card-shell`

## `soft-product`

- Posture: friendly consumer / productivity app
- Surfaces: `#fafafa`, cards `#ffffff`, border `#ececec`
- Accent: `#2563eb` only if brand requires blue — prefer a brand-specific hue from the brief; never default indigo stack
- Type: system UI sans; slightly larger body (16–17 px)
- Avoid: skeuomorphism, heavy gradients, emoji icon grids
- Good shells: `auth-shell`, `newsletter-shell`, `waitlist-shell`, `settings-shell`, `dashboard-shell` (lighten tokens)

## `harbor-navy`

- Posture: institutional / classic B2B / professional services
- Surfaces: cool gray `#f3f5f8`, ink `#0b1f33`
- Accent: deep navy `#1e3a5f` (sparse; prefer type hierarchy over color)
- Display: serif for titles; body: system sans
- Avoid: neon accents, playful illustration, soft-product blues
- Good shells: `landing-shell`, `pricing-shell`, `article-shell`, `resume-shell`, `business-card-shell`

## `paper-mono`

- Posture: print / CV / quiet documentation
- Surfaces: stone `#f5f5f4`, paper white, ink `#171717`
- Accent: ink itself (near-monochrome; status colors only when needed)
- Display: transitional serif; body: system sans; tight small type OK
- Avoid: colored hero washes, large radii, decorative shadows
- Good shells: `resume-shell`, `article-shell`, `email-shell`, `flyer-shell`

## `botanical-calm`

- Posture: wellness / nature / quiet consumer product
- Surfaces: sage wash `#f4f6f1`, soft paper `#fbfcf8`
- Accent: leaf green `#3f6b4e` (max 2 uses per screen)
- Display: serif; body: system sans; generous leading
- Avoid: neon fitness gradients, emoji icon grids, purple wellness clichés
- Good shells: `landing-shell`, `onboarding-shell`, `newsletter-shell`, `invite-shell`

## `midnight-editorial`

- Posture: dark magazine / portfolio / cultural brand
- Surfaces: near-black `#121212`, warm paper ink `#f3efe6`
- Accent: copper `#d4a574` (one strong moment per view)
- Display: Georgia / serif; body: system sans
- Avoid: neon cyberpunk, glassmorphism, signal-yellow
- Good shells: `landing-shell`, `article-shell`, `deck-shell`, `business-card-shell`

## `copper-ledger`

- Posture: warm utility / docs / ops with craft feel
- Surfaces: warm gray `#f7f3ee`, paper `#fffdf9`
- Accent: saddle copper `#8b4513`
- Type: system sans throughout; monospace for IDs / codes
- Avoid: cool slate-only chrome, fintech teal defaults, soft blue CTAs
- Good shells: `settings-shell`, `data-table-shell`, `dashboard-shell`, `article-shell`
