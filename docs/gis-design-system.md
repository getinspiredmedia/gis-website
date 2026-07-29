# GIS Design System

## 1. Brand identity

**Name:** Get Inspired Society

**Tone:** Sober, declarative. No marketing register, no urgency, no pressure on a call to action. No long dashes — use a comma, a full stop, or a line break. Never the word "community" in public copy.

**Anchor lines:**
- *No algorithm decides what's here.* — Home
- *Not everything belongs. The right work does.* — Society

**Audiences:** Two audiences — makers and viewers. For their definitions, see `docs/gis-project-brief.md` section 2. They are introduced late on each page and never separated in the navigation.

---

## 2. Typography

One family: **Archivo variable**, axes `wdth 75..125` and `wght 400..700`. Display sizes use the width axis, not a second typeface. Everything under 20 px stays at normal width.

| Role | Size | Weight | Width | Notes |
|---|---|---|---|---|
| statement | `clamp(2.4rem, 6.6vw, 5.6rem)` | 700 | wdth 118 | lh .94 · ls -.02em |
| page title | `clamp(2.2rem, 5.4vw, 4.4rem)` | 700 | wdth 116 | lh .96 |
| section title | `clamp(1.8rem, 4.2vw, 3.2rem)` | 700 | wdth 110 | lh 1.02 |
| row title | `clamp(1.15rem, 2.2vw, 1.5rem)` | 600 | normal width | — |
| lede | `clamp(1rem, 1.7vw, 1.35rem)` | 400 | normal | lh 1.45 · max 30ch |
| body | `15px` | 400 | normal | lh 1.65 · max 46ch |
| eyebrow | `11px` | 600 | normal | ls .22em · uppercase |
| meta | `12px` | 400 | normal | muted |

> ⚠️ **Implementation note:** The CSS classes in `docs/design-system.html` (`.t-statement`, `.t-h1`, etc.) use different clamp values than the spec table above. The spec table is canonical. When implementing, use the spec table values, not the CSS demo values. See the terugrapportage in the git history for the full list of discrepancies.

---

## 3. Color palette

Seven tokens, no more.

| Token | Hex | Function |
|---|---|---|
| `--blue` | `#0d2ec4` | Statements, doors, focus |
| `--ink` | `#0b0c10` | Show pages, footer, nav |
| `--wall` | `#111319` | On View background |
| `--band` | `#0f1118` | Second dark layer |
| `--paper` | `#ffffff` | Reading pages |
| `--muted` | `#5b616b` | Secondary text |
| `--line` | `#e4e6ec` | Rules, borders, empty states |

**Accessibility rule:** White on blue and white on ink only. Ink on blue fails contrast and is never used.

> **Note:** The section header in `design-system.html` also describes blue as being used for progress (the On View progress bar), but the swatch label lists only "Statements, doors, focus". Both are accurate: blue is used for the progress bar fill in the Plaque component. The swatch label is not exhaustive.

---

## 4. Components

Nine components. Every component is demonstrated live in `docs/design-system.html`.

**Masthead**
Navigation bar. Ink background, white text. On scroll: wordmark drops from 88 to 40 px and the black bar arrives (`400ms`). Bar retreats upward on scroll down, returns on scroll up (`450ms`). Navigation items are outlined pills (`.menuitem`); the log-in action is a filled blue pill (`.pill`).

**Button**
Outlined pill in the current text colour, one shape, three grounds (paper / ink / blue). On hover: fills with its opposite and the gap between label and arrow widens. There is no filled primary button anywhere except the log-in pill.

**Statement panel**
A blue field with one line and nothing else competing. Exactly one per page. The line rises from below the fold of its own container when it enters view. Never two on a page, never a paragraph next to it.

**Editorial row**
A label on the left, one sentence on the right, an optional link at the end. Used on the Society page and for routing on Contact. Stacks on mobile.

**Archive row**
For lists where every entry is a destination. On hover the entire row fills blue — the same vocabulary as the tile grid, stretched into a line. Cover image lifts and scales on hover.

**Tile**
Images sit at reduced brightness and grayscale until approached; on hover they lift to full brightness. The artist name appears on a gradient, not a card. Tiles never carry buttons — the whole tile is the target.

**Doors**
Two halves of equal weight: one on paper, one on blue. This is the only place where the two audiences are separated. Always sits at the bottom of a page, never in the navigation.

**Plaque and progress**
Museum wall label, bottom left, always in the same position. Used on the On View page only. The blue progress bar at the foot of the screen fills over twenty seconds and is the only clock on the site.

**Field**
Square corners, hairline border (`--line`), blue on focus. Labels sit above the field in eyebrow style. No placeholder-only fields, no required-field stars.

---

## 5. Architecture

**Domain:** One static domain `getinspiredsociety.com`, using paths rather than subdomains.

**Circle:** Community platform moved to `society.getinspiredsociety.com`. The main site never checks membership itself.

**Open decision — `/on-view` (resolve before building)**

Two options are on the table:

- **Option A — Restyled rebuild within this repo:** `/on-view` is rebuilt as a section inside `getinspiredmedia/gis-website`, styled to match this design system.
- **Option B — Proxy to separate Railway app:** `/on-view` proxies requests to the existing `getinspiredmedia/on-view` app running on its own Railway project.

⚠️ **Known conflict:** The project brief (`docs/gis-project-brief.md` section 5) records an earlier "one repo, one host" decision: the Express app serving On View would also serve the rest of the site, because the contact form via Resend requires a running server that is already there. Option B (proxy) directly contradicts this. This conflict must be explicitly resolved before any work starts on `/on-view`.

---

## 6. Open decisions

- **`ROOM_URL`** — artsteps embed URL for the On View room — `[to confirm]`
- **Tally form link** — URL behind "Apply as a creative" — `[to confirm]`
- **PDF and print-order links** — links in the reader and magazine — `[to confirm]`
- **Circle custom domain** — confirmation that the domain switch does not log out existing members — `[to confirm]`
- **Autumn open call calendar** — full date schedule — `[to confirm]`
