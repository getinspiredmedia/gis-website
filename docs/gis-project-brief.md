# GIS Website — Project Brief

## 1. Project description

Get Inspired Society is an independent visual arts platform, active since 2009, based in Rotterdam, founded and led by André Kreft. Four issues per year, five artists per issue, twenty spots per year.

The goal of this rebuild is to bring everything together under one domain (`getinspiredsociety.com`). Priority order: the work first, then the magazine, then the gallery. Two audiences (makers and viewers) are deliberately kept separate — introduced late on each page, never in the navigation.

This project (`getinspiredmedia/gis-website`) is a greenfield rebuild, fully independent of `getinspiredmedia/on-view`. No shared dependencies, databases, or configuration.

---

## 2. Target audience

**Makers** — access only via portfolio review. Participate in open calls, show work weekly, can be selected for an issue and an exhibition.

**Viewers** — read, browse, can subscribe or buy prints. No account required for gallery or magazine.

The two audiences are kept separate: introduced late on each page, never distinguished in the navigation.

---

## 3. Sitemap

Eight top-level paths. No extension in URLs; each path is served by its own `index.html` in `public/`.

| Path | Description |
|---|---|
| `/` | Home — landing page; entry point for both audiences |
| `/on-view` | On View — currently a skeleton; see Open Decisions for architecture status |
| `/magazine` | Magazine — four issues per year, five artists per issue |
| `/gallery` | Gallery — viewable without an account |
| `/society` | Society — platform identity and context |
| `/about` | About — background on Get Inspired Society and André Kreft |
| `/contact` | Contact |
| `/support` | Support — subscribe or buy prints; no account required |

Paths `/work/:slug` and `/magazine/:issue` are not part of this scaffold and are not listed here.

---

## 4. Technical setup

- **Repo:** `getinspiredmedia/gis-website`
- **Branch:** `master`
- **Railway public domain:** `gis-website-production.up.railway.app`
- **Railway internal address:** `gis-website.railway.internal` (private network only)
- **Auto deploy:** on push to `master`
- **Runtime:** Node.js (>=20.0.0), Express 4.x

**Folder layout**

```
public/
├── index.html          → /
├── on-view/index.html  → /on-view
├── magazine/index.html → /magazine
├── gallery/index.html  → /gallery
├── society/index.html  → /society
├── about/index.html    → /about
├── contact/index.html  → /contact
└── support/index.html  → /support
```

URLs have no file extension; `express.static` resolves directory paths to their `index.html`.

**Current state of `server.js`**

```js
app.use(express.static(path.join(__dirname, 'public')));
```

Only the static folder is registered. No API routes and no catch-all exist yet.

**Intended route order (from project brief — not yet implemented)**

When API or app routes are added, the intended order is:
1. Static folder (`public/`) — first
2. API / app routes — second
3. Catch-all — last, and only applicable to On View paths

> ⚠️ Do not add a global catch-all before the On View architecture decision is resolved (see Open Decisions).

---

## 5. Open decisions

### `/on-view` — rebuild or proxy (resolve before building)

**This decision must be made before any work starts on `/on-view`.**

Two options are on the table:

- **Option A — Restyled rebuild within this repo:** `/on-view` is built as a new section inside `getinspiredmedia/gis-website`, styled to match the GIS design system.
- **Option B — Proxy to separate Railway app:** `/on-view` proxies requests to the existing `getinspiredmedia/on-view` app, which runs independently on its own Railway project.

⚠️ **Known conflict:** An earlier decision recorded in the project brief established a "one repo, one host" principle, under which the entire GIS website — including On View — would live in this single repo and Railway project. Option B (proxy) directly contradicts this. This conflict must be explicitly resolved before building `/on-view`. It has not been resolved elsewhere in this repo (neither in `README.md`, `DECISIONS.md`, nor `CLAUDE.md` — only the deferral of the choice is recorded).

---

### Other open points

- **Circle custom domain** — `[to confirm]`
- **artsteps `ROOM_URL`** — `[to confirm]`
- **Tally form link** — `[to confirm]`
- **PDF / print links** — `[to confirm]`
- **Autumn open call dates** — `[to confirm]`
- **Custom domain `getinspiredsociety.com`** — DNS configuration deferred; site currently runs on Railway subdomain only
