# Luca Chech AI — Design System ("Kinetic Logic")

A brand & UI design system for **Luca Chech AI**, the personal brand of a solo
AI-automation consultant serving SMEs (PMI) in the Veneto region of northern
Italy. The system is named **"Kinetic Logic"** / **"The Kinetic Narrative"** in
the source material — a deliberately warm, human, high-energy take on AI
consulting that rejects the cold "black-box" tech aesthetic.

> The site is fully in **Italian**. All product copy, labels, and examples in
> this system are Italian by design — do not translate them to English unless
> explicitly asked.

---

## 1. Product & business context

**What it is:** A personal-brand marketing website (`lucachech.it`) for Luca
Chech, an AI/ML engineer (6+ yrs: industrial computer vision, fintech credit
scoring, a PhD in human–machine interaction) now consulting freelance on **AI
process automation** for small and mid-sized businesses.

**The single product represented here:** the **marketing website** — a
long-scroll narrative homepage. There is no app, dashboard product, or docs
site in the source; the "AI Approval Dashboard" that appears on the site is a
*mockup inside a marketing section*, not a real product surface.

**Audience:** Non-technical PMI owners / managing directors, 35–55, in Veneto.
Skeptical of buzzwords, risk-averse, mobile-first, WhatsApp-native. The site
must feel trustworthy and human, never "techy" or startup-y.

**Positioning differentiators:** personal brand (no Italian AI competitor uses
one), transparent/low-risk framing, regional focus, WhatsApp-native contact,
use-case-led (never technology-led) messaging.

**Core services (presented by use case, never by technology):**
- Order-intake automation (WhatsApp/email orders read & registered)
- Document generation (quotes, contracts, DDTs from existing data)
- Translation for export
- Customer communication (responses, FAQ, booking)

### Sources this system was built from
All under the attached `website/` codebase (read-only mount):

| Source | Path | What it gave us |
|---|---|---|
| Live Astro site | `website/site/` | The real components, tokens, copy, images |
| Design tokens | `website/site/src/styles/global.css` | Tailwind v4 `@theme` color + font tokens |
| Component library | `website/site/src/components/*.astro` | 11 homepage sections (Hero, Solutions, Roadmap…) |
| Design spec | `website/stitch_homepage/DESIGN.md` | "Kinetic Narrative" creative direction & rules |
| Business brief | `website/claude.md` | Audience, positioning, messaging rules, SEO |
| Real images | `website/site/public/{luca,recognition}.png` | Consultant photo + hand-drawn illustration |

Images and tokens have been copied into this project (`assets/`,
`colors_and_type.css`) so the system is self-contained.

---

## 2. Content fundamentals (voice & copy)

The voice is **warm, direct, confident, and plain-spoken** — an expert friend,
not a vendor. Everything is in **Italian**.

- **Language:** Italian only. No English, no bilingual compromise.
- **No jargon, ever.** The words LLM, RAG, NLP, "agentic", machine learning,
  neural network are banned from customer-facing copy. Speak in business
  outcomes. (The one exception the site allows itself: "**Agenti AI**" used
  once, narratively, to mark the shift from chatbots to action.)
- **Person:** Mixes **"io" (Luca)** and **"noi" (the journey together)**.
  First person singular for the personal promise ("*Costruisco sistemi…*",
  "*Ti affianco finché non funziona senza di me*"); first person plural for the
  collaborative process ("*Analizziamo…*", "*la nostra tabella di marcia*").
  Addresses the reader as informal **"tu"** throughout ("*Smetti di perdere
  tempo*", "*Sei curioso, ma ti senti un po' perso*").
- **Casing:** Sentence case for headlines and body. **ALL-CAPS only** for tiny
  status/eyebrow labels ("CONSULENTE AI & AUTOMATION", "IERI: MANUALE & LENTO",
  "OGGI: AUTOMATIZZATO", "FASE 01") and a few punchy section heads
  ("ZERO RISCHI."). Caps labels carry wide letter-spacing.
- **Benefit-first headlines.** "*Automatizza il lavoro, sblocca la crescita*"
  not "Consulenza AI". "*Risparmia ore*" over feature names.
- **Concrete scenarios over abstractions.** Always ground claims in a specific
  morning-in-the-life ("*La mattina inizia con la casella piena…*" → "*La
  mattina scorre fluida…*"). Before/after storytelling is the signature device.
- **Human-in-control reassurance** is a recurring beat: "*Tu resti il regista —
  l'AI fa la fatica*", "*L'Uomo resta il pilota*", "*Sicurezza e controllo
  garantiti al 100%*".
- **Risk-removal language:** "*Si parte in piccolo*", "*Risultati chiari o non
  paghi*", "*Nessun vincolo*", "*amici come prima*".
- **Rhythm & punctuation:** Short declaratives. Em-dashes and ellipses for a
  conversational, spoken cadence. Occasional rhetorical question as a section
  opener ("*Un esempio concreto?*").
- **Emoji:** **None.** The brand does not use emoji in product copy.
- **Vibe in one line:** *"L'ingegnere che ti restituisce il tuo tempo."*

---

## 3. Visual foundations

The creative north star is **"The Radiant Guide" / Active Humanism**: warm,
tactile, optimistic, in motion. The layout is a **continuous narrative**, not a
grid of isolated boxes.

### Color
- **Primary — Electric Blue `#0058bc`** (container `#0070eb`): the analytical
  voice. Used for trust, CTAs-in-text, success states, structure.
- **Secondary — Solar Orange `#fe9400`** (the "Energy" color): the human spark.
  Used **sparingly** as a highlight and for the highest-conversion buttons —
  never as a large background fill.
- **Tertiary — Burnt Sienna `#c64f00`**: rare accent, mostly in card variety.
- **Surfaces** are **warm-tinted near-whites/grays** (`#f9f9f9` → `#ffffff`),
  *never* flat `#808080` gray. Neutrals lean blue/warm.
- **Error red `#c0504c`** is the only alert color.
- **No green — anywhere.** Success is communicated in blue, not green. This is
  a hard rule from the design spec.

### Type
- **Space Grotesk** for all display/headline — tech-forward, geometric, bold,
  tight leading, **−2% to −4% letter-spacing** for a "packed" editorial feel.
- **Work Sans** for body + labels — invisible, airy, conversational, generous
  line-height (~1.6).
- Big type is encouraged: hero scales to `~8rem`, headlines `3.75–4.5rem`.

### Backgrounds & texture
- Base `surface` with a subtle **noise/grain** texture (premium heavy-stock
  paper feel).
- **Organic "blob" glows**: large, heavily-blurred ( `blur 120–160px`) radial
  shapes in primary and secondary tones, low opacity, drifting behind hero and
  feature sections — sometimes slow `animate-pulse`/`floating`.
- A faint **radial dot grid** (`24px` spacing, 5% opacity, primary dots) used
  behind the Roadmap.
- The **signature gradient** — `135°, #0058bc → #004493` — for big statement
  slabs ("The Shift", the After card, the final CTA) and primary accents.

### The "No-Line" rule (important)
**1px solid borders for sectioning are prohibited.** Boundaries are defined by
**tonal transitions** — shift the background between `surface`,
`surface-container-low`, `surface-container-lowest`, etc. No `<hr>`, no hard
dividers. If a border is truly needed for accessibility, use a **"ghost border"**:
`outline-variant` at ~15–30% opacity.

### Elevation
- Reject flat drop shadows in favor of **tonal layering** (stack surface tiers)
  and **ambient "Solar Flare" diffusion** when something must float:
  `0 12px 32px -4px` at ~6% `on-surface`, faintly tinted toward primary/energy.
- Glassmorphism for the floating nav and overlays: `surface` at 80% opacity +
  `20px` backdrop-blur.

### Shape & corners
- **Never sharp.** Everything is `ROUND_EIGHT` (`0.5rem`) or larger. Buttons
  `0.5rem`; cards climb the radius scale up to `2–3rem`; hero panels `4rem`;
  chips are full pills.

### Cards
- Base `surface-container-lowest` (#fff), no divider lines, generous padding.
- Feature cards use a **1px-gradient-tinted "ring"** wrapper (`p-1` of a
  primary/secondary/tertiary container at ~20% opacity) around a white inner
  card with a large radius — a soft halo, not a hard border.
- Icon sits in a rounded colored tile (`primary` / `secondary-container` /
  `tertiary-container`) top-left.

### Motion
- Energetic but tasteful, transform-based. Cards lift (`-translate-y` ~0.5rem)
  and icons **scale + rotate a few degrees** on hover. Buttons **lift on hover,
  scale down (`active:scale-95`) on press**. Slow `floating` (3s ease-in-out)
  on quote chips; `animate-pulse` on glows and "pending" states; `animate-ping`
  on status dots. Durations `300–500ms`, default easing.

### Intentional asymmetry
- Elements are nudged off-grid: photos `rotate-2`/`rotate-3`, quote cards
  `-rotate-2`, pain-point cards each at slightly different rotations and small
  x-offsets so they feel hand-placed and "in motion". Images overlap the
  boundary between two background colors to create narrative flow.

### Hover / press summary
- **Hover:** lift (translate-y), soft colored shadow grows, icon scale+rotate,
  ghost-border appears, link text → primary.
- **Press:** `active:scale-95` (buttons shrink slightly).

---

## 4. Iconography

- **Primary icon system: Google "Material Symbols Outlined"** — loaded as a
  variable icon font from Google Fonts. This is the only icon set used across
  the site (search, rocket, description, event, chat, bolt, sync, verified,
  architecture, code, school, rocket_launch, arrow_forward, warning, …).
  - Stroke/fill is controlled via font-variation-settings; the site flips
    `'FILL' 1` on a few emphasis icons (e.g. `verified_user`, `rocket_launch`).
  - Load with:
    `<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet">`
    then `<span class="material-symbols-outlined">icon_name</span>`.
- **No custom SVG icon set** exists in the source, and **no emoji** are used as
  icons. Unicode glyphs are not used decoratively.
- **Illustration:** one **hand-drawn, black-ink sketch** style illustration
  (`assets/recognition.png`) — a loose, expressive doodle of a confused figure
  surrounded by question marks. This rough, human, monochrome-ink style is the
  brand's illustration register: imperfect and personal, the opposite of
  glossy stock tech art. (See `claude.md`: avoid robots/circuits/glowing
  brains; prefer human + real-business imagery.)
- **Photography:** real photo of the consultant (`assets/luca.png`) — warm,
  approachable, neutral background, arms-crossed portrait. Human faces over
  abstract tech imagery.
- **Brand mark:** the brand uses a **typographic wordmark** — "**Luca Chech
  AI**" set in Space Grotesk, `font-black`, tight tracking, in `--primary`
  blue. There is **no dedicated logo glyph.**
  - ⚠️ **Caveat:** `assets/favicon.svg` in the repo is still the **default
    Astro starter logo**, *not* a real brand mark. It is included only for
    completeness; do not treat it as the Luca Chech AI logo. See Caveats.

---

## 5. Index / manifest

Root files:
- **`README.md`** — this file (context, content, visual, iconography, index).
- **`colors_and_type.css`** — all color + type + radius + shadow tokens as CSS
  custom properties, plus optional `.kl` semantic element styles.
- **`SKILL.md`** — Agent-Skill front-matter wrapper for use in Claude Code.
- **`assets/`** — `luca.png` (consultant portrait), `recognition.png` (ink
  illustration), `favicon.svg` (⚠️ default Astro mark — not real brand).
- **`research/`** — `stitch_screen.png` (original Stitch homepage mock, for
  reference only).
- **`preview/`** — small specimen cards rendered in the Design System tab
  (colors, type, components, etc.). Reference-only, not production components.
- **`ui_kits/website/`** — high-fidelity React/JSX recreation of the marketing
  site: `index.html` (interactive long-scroll homepage) + component JSX files.
  See its own `README.md`.

There are no slide templates in the source, so no `slides/` folder was created.

---

## 6. Caveats / open questions

- **Fonts** (Space Grotesk, Work Sans, Material Symbols) are loaded from
  **Google Fonts CDN**, matching the live site. No local font files were
  present to copy. If you need offline/self-hosted copies, ask and I'll add
  them to `fonts/`.
- **The favicon is the default Astro logo**, not a real brand mark. The brand
  currently relies on the "Luca Chech AI" wordmark. If a real logo exists,
  please share it.
- **Single surface.** Only the marketing site exists in the source. The "AI
  Approval Dashboard" is a marketing mockup, not a shipped product UI, so the
  UI kit treats it as such.
- Contact integrations (Calendly, WhatsApp, LinkedIn) are referenced in copy
  but not wired — the UI kit fakes them as click-through.
