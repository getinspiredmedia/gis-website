# GIS Design System

## 1. Brand identity

**Name:** Get Inspired Society

**Tone:** Sober, declarative. No marketing register, no urgency, no pressure on a call to action. No long dashes — use a comma, a full stop, or a line break. Never the word "community" in public copy.

**Anchor lines:**
- *No algorithm decides what's here.* — Home

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
Navigation bar. Ink background, white text. On scroll: wordmark drops from 88 to 40 px and the black bar arrives (`400ms`). Bar retreats upward on scroll down, returns on scroll up (`450ms`). Navigation items are Magazine and Gallery, as outlined pills (`.menuitem`). There is no log-in action, no Society item and, since the On View weekly wall is out of the navigation for the duration of the issues-focused homepage (see §5), no On view item either: Society, Circle and On view were removed from the nav, and `/society` answers a 301 to `/`. `/on-view` and `/work/:slug` still exist and still work (reachable from the issue 05 card's fallback, direct links, search engines, etc.). Only the nav/footer entry point is gone, not the route.

Below `860px` (the same breakpoint the tile grid and doors collapse at in the live pages, e.g. `build/pages/index.html`'s `.grid`/`.doors`) the row is replaced by a hamburger toggle to the right of the wordmark. The wordmark drops to a fixed 40 px: it no longer scales with viewport width. The toggle opens a fullscreen ink panel, always white-on-ink regardless of the desktop nav's colour variant (`data-variant="light"` included) and regardless of the homepage hero's luminance-adaptive logo colour: Magazine / Gallery are stacked in page-title-weight type (`wdth 116`, `700`). Opening moves focus to the first item; `Esc` or a link click closes it and returns focus to the toggle. The animation collapses under `prefers-reduced-motion: reduce`. The toggle carries `aria-expanded` (toggled true/false), `aria-controls` (pointing at the panel's id) and an `aria-label` that switches between "Open menu" and "Close menu" — verified against Chromium's accessibility tree, not just the DOM attributes. The wordmark stays visible and tappable while the panel is open — it sits above the panel (`z-index:2` against the panel's `1`) rather than being covered by it. This was a deliberate choice over adding a separate "back to home" control inside the panel: the wordmark already is the home link everywhere else in the system, so keeping it live avoids introducing a second, redundant way to do the same thing, and needed only a z-index change rather than new markup.

Shared markup, styles and script live in `build/partials/nav.html` and are injected into every build-system page; `public/on-view/index.html`, `public/work/index.html` and every magazine reader (`public/magazine/<slug>/index.html`, found by glob) carry identical hand-maintained copies since they sit outside the build system (see `docs/gis-project-brief.md`/CLAUDE.md — `/on-view` is deliberately excluded from the build pipeline). `npm run build` runs `build/check-nav-drift.js` first and aborts if that copy has drifted from the partial (markup, toggle script, and the toggle's `aria-expanded`/`aria-controls`/`aria-label` are all compared explicitly — an ARIA-only edit fails the check by name, not just as a generic "markup drifted"); run it standalone with `npm run check:nav-drift`. `npm run test:nav-drift-aria` is the regression test proving that ARIA sensitivity — it temporarily mutates the partial's `aria-label`, asserts the drift check names the mismatch, then restores the original file.

> **Breakpoint note:** the nav's mobile threshold (`860px`) intentionally does not match the `760px` used in `docs/design-system.html`'s own demo-page layout (`.spec`, `.erow`, `.tiles`, `.doors` — the documentation page's grid, not the live site's). `860px` was chosen because it is the value the actual production components collapse at (the nav's own pre-existing tablet tweak, and the homepage's `.grid`/`.doors`). `760px` only exists inside the design-system reference page itself and governs that page's own two-column documentation layout, unrelated to any live component. The two are not harmonized because they solve different problems — one is a live-site component breakpoint, the other is a documentation-page layout breakpoint — and forcing them to match would make one of the two collapse at the wrong width for its own content.

**Button**
Outlined pill in the current text colour, one shape, three grounds (paper / ink / blue). On hover: fills with its opposite and the gap between label and arrow widens. There is no filled primary button anywhere.

**Statement panel**
A blue field with one line and nothing else competing. Exactly one per page. The line rises from below the fold of its own container when it enters view. Never two on a page, never a paragraph next to it.

**Editorial row**
A label on the left, one sentence on the right, an optional link at the end. Used for routing on Contact. Stacks on mobile.

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

**Society and Circle:** Circle is discontinued. The Society page and the Log in pill are gone from the site, and `/society` answers a 301 to `/`. The redirect for `society.getinspiredsociety.com` is set up in Cloudflare, not in this repo.

**Round winner.** Every submission is reviewed by an admin before it is public, and approved work stays on view for seven days. In an open call round the most viewed work wins a t-shirt. Views are deduplicated per visitor per work within 24 hours, and the raw count is never shown publicly. Tiebreak on equal views: earliest submission. The /on-view statement is "Reviewed first. Then seen.", because review decides what is public and the audience only decides the prize. The earlier plan, members voting inside Circle with André picking the lead, is dropped. This mechanism is unchanged; only the homepage's promotion of it (described next) is gone for now.

**Homepage (`/`): a temporary showcase for the issues, the gallery and the issue 05 open call.** GIS World, the eventual permanent home, is still in development, so `/` doesn't run the On View weekly-rotation hero described above any more. It's entirely about the magazine issues until that's ready. Ink ground throughout except the statement panel, so the page still has exactly one blue field. Top to bottom:
1. **Hero**: a cold open on the Bloom cover (full bleed, `scale(1.15) → 1`), two seconds of image alone, then eyebrow "Issue 04 · out now", `<h1>` "Bloom." (width axis 75 → 118, lettered stagger), the line "Nothing opens on command.", and an outlined pill "Read the issue →" to `/magazine/bloom`. Timings in §6.
2. **Issue strip**: "The magazine" / "Five artists. One theme. Four times a year." / "Free to read.", then five cards: 04 Bloom, 03 Chasing Light, 02 No Algorithm, 01 Origins, and an open, dashed-border 05 card ("Untitled" / `ISSUE_CALL_CARD_LINE`). Above 860px the section pins and the cards slide horizontally with the page scroll (GSAP ScrollTrigger, scrubbed); the card nearest the viewport's centre is full colour at scale 1 with a large outline numeral behind it, the rest are grayscale at `brightness(.85) scale(.82)`. Below 860px: no pin, a native horizontal scroll-snap row instead, every card shown at full colour. Each card is `data-cursor="Read"` and carries a `view-transition-name`.
3. **Statement**: "No algorithm decides what's here." (the page's one blue field).
4. **Exhibition band**: a 16:9 Bloom artwork with slow parallax (`data-cursor="Enter"`) and "Exhibition no. 4" / "Walk through Bloom." / "The fourth issue, hung in a room you can move through." / an outlined pill "Enter the room →" to `/gallery`.
5. **Doors**: the whole half is the link, no separate button inside either (see Doors component above, which otherwise stays as documented). Paper: "To look" / "Come and see." / "The work and the magazine are open. No account, no wall.", linking to `/magazine`. Blue: "To be seen" / "Show your work." / `ISSUE_CALL_DOOR_LINE`, linking to `ISSUE_CALL_URL`. The issue-05 strip card links to the same `ISSUE_CALL_URL`.
6. **Footer**: unchanged (tagline "Seventeen years of looking.").

**`ISSUE_CALL_URL`, `ISSUE_CALL_CARD_LINE` and `ISSUE_CALL_DOOR_LINE`** live together in `build/pages.config.js` and are injected into `build/pages/index.html` by `build/build.js` (the `{{ISSUE_CALL_URL}}` / `{{ISSUE_CALL_CARD_LINE}}` / `{{ISSUE_CALL_DOOR_LINE}}` tokens), never hardcoded on the page itself. Until André's own issue 05 submission form exists (deliberately separate from `/submit`, the weekly On View form), `ISSUE_CALL_URL` points at `/magazine`, a real page, instead of a dead placeholder link, and the two copy lines say the open call hasn't started yet rather than claiming it's already running with a close date that isn't true yet (every claim on the site has to be true on the day it's live). The three values are swapped together, in this one file, the moment the open call actually opens, no separate code change needed.

Nothing on the homepage links to `/submit` or `/on-view` any more; both routes still work; they're just not promoted from `/` while this showcase is live. Cross-document View Transitions (`@view-transition { navigation: auto; }`) are opted into on the homepage for internal navigation, falling back to the block wipe where the browser doesn't support it (or under reduced motion), see §6.

**Open decision — `/on-view` (resolve before building)**

Two options are on the table:

- **Option A — Restyled rebuild within this repo:** `/on-view` is rebuilt as a section inside `getinspiredmedia/gis-website`, styled to match this design system.
- **Option B — Proxy to separate Railway app:** `/on-view` proxies requests to the existing `getinspiredmedia/on-view` app running on its own Railway project.

⚠️ **Known conflict:** The project brief (`docs/gis-project-brief.md` section 5) records an earlier "one repo, one host" decision: the Express app serving On View would also serve the rest of the site, because the contact form via Resend requires a running server that is already there. Option B (proxy) directly contradicts this. This conflict must be explicitly resolved before any work starts on `/on-view`.

---

## 6. Motion

A small, shared, self-hosted module, `public/js/motion.js` (GSAP + ScrollTrigger + Lenis, vendored into `public/js/vendor/` by `npm run build`, never a CDN), plus page-specific choreography built on top of it. First and so far only consumer: the homepage (`build/pages/index.html`). Every motion effect below is off under `prefers-reduced-motion: reduce`, falling back to the instant end state or a short fade (the sitewide `*{animation-duration:.01ms!important;transition-duration:.01ms!important}` rule, already in use elsewhere), never a larger movement.

| Effect | Where | Timing | Trigger | Reduced motion |
|---|---|---|---|---|
| Cold open | Homepage hero | Image alone for 2000ms, then copy fades/lifts in over 900ms; image itself scales `1.15 → 1` over 2400ms; the `<h1>` letters animate `font-variation-settings 'wdth' 75 → 118` over 700ms each, staggered 60ms apart | On load | Final state shown immediately, no animation |
| Reveal | Any `.rv` element (statement rise included, via `.claim`'s own CSS) | Fade + 22px lift, 900ms; statement rise is a 105%→0 translateY over 1100ms in a clipped container | Once, at 20% in view; `data-reveal-group` staggers members 110ms apart in document order | Short fade only |
| Issue strip pin | Homepage issue strip, ≥861px | Scrubbed to scroll position (no fixed duration); active-card crossfade (grayscale/scale) 500ms | Pinned for the scroll distance of the track's full width; re-evaluated on resize via `gsap.matchMedia()` so crossing 860px never leaves a duplicate `ScrollTrigger` or a stale pin | No pin: a plain horizontal scroll-snap row instead (CSS only, below 860px regardless of motion preference) |
| Cursor label | Any `[data-cursor]` element (issue cards, exhibition poster) | 88px circle, position lerped toward the pointer at a 0.18 factor per frame; label opacity/scale 250ms | Pointer `pointerover`/`pointerout` on a `[data-cursor]` element | Not created at all (and never on `pointer: coarse`) |
| Block wipe | Internal link navigation (any page using `motion.js`) | Blue field scales up over 900ms, navigates at 430ms, scales back down after landing | Click on an internal, same-origin link (not a modifier-click, `target="_blank"`, `download`, or a `#anchor`) | Not attached: a plain, instant navigation |
| Cross-document View Transition | Internal link navigation, homepage only | Browser-native, no fixed duration (the UA's own crossfade; a matching `view-transition-name` on both ends would morph instead, but no destination page in this repo declares one yet) | `@view-transition { navigation: auto; }` in the homepage's own `<style>`; `motion.js` detects support via `'onpageswap' in window` and steps aside (doesn't attach the block wipe) when it's there | Same as block wipe: native browsers currently respect `prefers-reduced-motion` for this themselves; `motion.js` additionally never relies on it being supported |
| Masthead scroll | Every page using `motion.js` | Shrink 88→40px / hide / show, 400ms / 450ms (same as the shared `nav.html` partial's own transitions elsewhere) | Scroll position and direction | Unaffected (already a CSS transition, collapsed by the sitewide reduced-motion rule) |
| Exhibition parallax | Homepage exhibition band poster | `yPercent -8 → 8`, scrubbed to the section's scroll position | Scroll through `.exhibit` | Static image, no movement |
| Mouse parallax | Homepage hero image, ≥861px | Up to 12px of translate, 1:1 with pointer position (no easing/lag) | `pointermove` | Not attached |

---

## 7. Open decisions

- ~~**`ROOM_URL`**~~ — **Resolved.** The room is `https://www.getinspiredgallery.com/` (repo `gis-gallery`), embedded on `/gallery` after a click.
- **Tally form link** — URL behind "Apply as a creative" — `[to confirm]`
- **PDF and print-order links** — links in the reader and magazine — `[to confirm]`
- **Autumn open call calendar** — full date schedule — `[to confirm]`
- ~~**`public/work/index.html` nav inconsistency**~~ — **Resolved.** The work-detail page ran its own nav (`.masthead-wordmark` / `.menuitem`, text wordmark, no logo, no scroll-shrink, no Log in pill, an extra "On View" link) instead of the standard Masthead. No deliberate reason found in its git history — it was built in the same initial commit as On View's MVP, before `build/partials/nav.html` existed as a shared component, and was simply never migrated afterward. Replaced with a hand-maintained copy of the standard Masthead (same pattern as `/on-view` and the magazine reader pages), including the mobile hamburger and ARIA attributes; `build/check-nav-drift.js` was generalized from a single on-view/partial comparison to a list (`HAND_MAINTAINED_COPIES`) so `public/work/index.html` is now covered by the same drift detection. The page-specific "&larr; On View" link inside `<main>` (a content affordance, not part of the nav bar) is unaffected.
- ~~**`.menu a` relies on a page-level reset it doesn't own**~~ — **Resolved.** `build/partials/nav.html`'s `.menu a` rule originally never set `text-decoration` itself; it depended on each host page's own global `a{text-decoration:none}` reset. All 7 build-system pages happened to have that reset, so the partial rendered correctly there by coincidence, not by design — `public/on-view/index.html` didn't have one (only a `box-sizing` reset), which is why every `.menu a` link there, including the Log in pill, showed the browser-default underline until fixed directly in that file. The partial now sets `text-decoration:none` on `.menu a` itself, so it no longer depends on a reset it doesn't own; any future page reusing it is covered regardless of that page's own CSS. No hover/focus/`aria-current`/`data-variant="light"` override ever re-introduced an underline, so this one declaration was sufficient. Confirmed no visual change on the 7 existing pages (their global reset already produced the same `none` before this fix).
