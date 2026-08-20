# Project Instructions for Claude

## Werkwijze

### 1. Onderzoek eerst de bestaande code
- Lees relevante bestanden voordat je wijzigingen maakt.
- Begrijp de bestaande architectuur, patronen en conventies.
- Gebruik `Grep` en `Glob` om snel de codebase te verkennen.

### 2. Maak alleen noodzakelijke wijzigingen
- Beperk wijzigingen tot wat de taak vereist.
- Voeg geen features toe die niet gevraagd zijn.
- Geen speculatieve verbeteringen of "while we're at it"-aanpassingen.

### 3. Volg de bestaande architectuur
- Houd je aan de bestaande mapstructuur, naamgevingsconventies en codepatronen.
- Introduceer geen nieuwe abstracties tenzij de taak dat expliciet vereist.
- Gebruik dezelfde stijl als de omringende code.

### 4. Geen onnodige refactors
- Verbeter geen werkende code buiten de scope van de taak.
- Drie vergelijkbare regels zijn beter dan een premature abstractie.
- Als iets werkt, laat het dan met rust.

### 5. Voer tests uit
- Draai bestaande tests na elke wijziging om regressies te detecteren.
- Controleer of nieuwe functionaliteit gedekt wordt door tests.
- Rapporteer als tests falen en los dit op voordat je de taak afsluit.

### 6. Rapporteer gewijzigde bestanden
- Geef aan het einde van elke taak een overzicht van welke bestanden zijn gewijzigd.
- Vermeld kort waarom elk bestand gewijzigd is.

### 7. Controleer security, performance en onderhoudbaarheid
- Vermijd veelvoorkomende kwetsbaarheden: XSS, SQL-injectie, command injection, etc.
- Schrijf geen code die onnodige bewerkingen uitvoert of geheugen verspilt.
- Code moet leesbaar zijn voor een toekomstige ontwikkelaar zonder extra uitleg.

## Codeerstijl
- Geen overbodige commentaar — alleen als de *reden* niet voor de hand ligt.
- Geen docstrings met meerdere paragrafen.
- Geen `console.log` of debugcode in commits.
- Verkies bestaande bestanden te bewerken boven het aanmaken van nieuwe.

---

## Projectspecifieke informatie

> Geregistreerd op 2026-07-29 na repository-analyse.

### Projectstatus
Express scaffold gereed en gepusht naar GitHub. Railway project actief.
- **GitHub:** `getinspiredmedia/gis-website`
- **Railway intern adres:** `gis-website.railway.internal` (alleen bereikbaar binnen Railway private network)
- **Railway publiek domein:** `gis-website-production.up.railway.app`

### Frameworks & libraries
- **Express 4.x** — statische bestanden + `/work/:slug` route
- Geen database, geen ORM, geen frontend framework

### Projectstructuur
```
GIS-website/
├── CLAUDE.md
├── README.md
├── package.json
├── package-lock.json
├── server.js              # Express entry point
├── .gitignore
├── .claude/
│   └── launch.json        # Dev-server config voor Claude Browser preview
├── docs/
│   ├── PRODUCT.md
│   ├── ARCHITECTURE.md
│   ├── IMPLEMENTATION_PLAN.md
│   ├── STATUS.md
│   └── DECISIONS.md
└── public/
    ├── index.html          # /
    ├── on-view/index.html  # /on-view  ← roterende wand + plaque + progress + standaard nav
    ├── magazine/index.html # /magazine
    ├── gallery/index.html  # /gallery
    ├── society/index.html  # /society
    ├── about/index.html    # /about
    ├── contact/index.html  # /contact
    ├── support/index.html  # /support
    ├── work/index.html     # /work/:slug  ← shell, slug gelezen via JS
    ├── assets/
    │   ├── mark.png               # logo (640×528, wit op zwart)
    │   ├── favicon-32.png         # 32×32 favicon (witte letters, transparant)
    │   ├── apple-touch-icon.png   # 180×180 apple touch icon (wit op blauw)
    │   └── gallery-poster.webp    # posterafbeelding voor /gallery
    ├── favicon.ico                # = favicon-32.png (PNG-formaat)
    └── data/works.json            # mockdata (10 werken)
```

### Buildsysteem — KRITISCH
Railway draait `npm run build` vóór `npm start`. Dit genereert `public/` uit `build/pages/`.

**Regel: bewerk ALTIJD `build/pages/*.html`, nooit direct `public/*.html` voor pagina's die in het buildsysteem zitten.**

```
build/pages/index.html    → public/index.html
build/pages/magazine.html → public/magazine/index.html
build/pages/gallery.html  → public/gallery/index.html
build/pages/society.html  → public/society/index.html
build/pages/about.html    → public/about/index.html
build/pages/contact.html  → public/contact/index.html
build/pages/support.html  → public/support/index.html
```

**Niet in buildsysteem** (bewerk `public/` direct):
- `public/on-view/index.html`
- `public/magazine/chasing-light/index.html`
- `public/magazine/no-algorithm/index.html`
- `public/magazine/origins/index.html`
- `public/admin/index.html`
- `public/submit/index.html`
- `public/work/index.html`
- `public/embed/index.html`
- `public/hand-in/index.html`

### Buildcommando's
- `npm install` — dependencies installeren
- `npm run build` — regenereer `public/` uit `build/pages/` (altijd uitvoeren na aanpassing build-bronnen)
- `npm start` — server starten via `exec node server.js`. De `exec` is bewust: zonder die vervangt npm's scriptrunner zichzelf niet door het node-proces, waardoor een `SIGTERM` (die Railway bij élke herdeploy stuurt, niet alleen bij een echte crash) de tussenliggende shell doodt zónder hem door te geven aan de node-child — die blijft dan verweesd draaien terwijl npm een non-zero exit logt (`npm error signal SIGTERM`), wat Railway als "Deploy Crashed" rapporteert. Met `exec` ontvangt `server.js` het signaal zelf en sluit netjes af via de graceful-shutdown-handler (SIGTERM/SIGINT → `server.close()` laat lopende requests afronden → `db.close()` → `process.exit(0)`, met een 10s force-exit-timeout als fallback).
  - Verificatie-deploy: 2026-08-01, controle-deploy getriggerd om te bevestigen dat een nieuwe container-swap met deze fix schoon verloopt (geen `npm error signal SIGTERM`, wel `Graceful shutdown gestart` in de logs). Zie André's handmatige bevestiging in Railway voor het definitieve resultaat.

### Testcommando's
- Nog geen geautomatiseerde tests. Handmatige verificatie via curl of browser.

### Linting & formatting
- Nog niet geconfigureerd.

### Typechecking
- Niet van toepassing (plain JavaScript, geen TypeScript).

### Architectuur
- Node/Express: `express.static` voor alle statische paden, daarna specifieke page-routes.
- Elk hoofdpad heeft een eigen submap met `index.html` in `public/`.
- `/on-view` toont roterende wand (shuffle-bag, 20s) met Plaque en progress-bar. Gebruikt de standaard nav (mark-logo + Magazine/Gallery/Society/Log in) inclusief scroll-shrink en wipe-transitie.
- `/work/:slug` rendert server-side (DB-lookup op slug, incl. OG/Twitter-tags, zie hieronder) en hoogt bij elk bezoek voor een bestaande slug `works.view_count` met 1 op — ruwe hit-teller, geen dedup op IP/sessie/tijd. Een onbekende slug hoogt niets op en maakt geen rij aan. Bekende OG-preview-scrapers (`SCRAPER_USER_AGENTS` in `server.js`: Facebook, Twitter/X, WhatsApp, LinkedIn, Slack, Discord, Telegram, case-insensitieve substring-match) tellen niet mee — pagina en OG-tags blijven voor hen wel normaal renderen. Onbekende/ontbrekende user-agent telt wél mee (fail-open).
- `archiveOldWorks()` zet werk van `previous` naar `archived` zodra het 7 dagen oud is (draait bij server-start en daarna elk uur via `setInterval`). Sinds 2026-08-20 mailt dit per gearchiveerd werk de maker (`works.email`) via het bestaande Resend-patroon: onderwerp "Your work has come down from On View", met link naar de blijvende `/work/:slug`-pagina en een re-engagement-CTA naar `/submit/:SUBMIT_TOKEN`. De `UPDATE ... RETURNING` pakt alleen rijen die nog `status='previous'` zijn, dus een werk wordt precies één keer gearchiveerd en gemaild — een serverherstart binnen hetzelfde uur triggert geen dubbele mail, er is geen aparte `email_sent`-vlag nodig. **Let op:** `/submit/:token` is géén permanente link per maker — het is één gedeeld, globaal token uit de env var `SUBMIT_TOKEN`, hetzelfde voor iedereen (zie route hieronder). De per-maker `/hand-in/:token` is wél uniek maar eenmalig (`tokens.used`), en is dus niet bruikbaar als herhaalbare CTA.
- **Route-volgorde in server.js:** `express.static` eerst, daarna page-routes (`/work/:slug`, `/submit/:token`, `/hand-in/:token`), geen catch-all.
- Database: better-sqlite3 in WAL-modus op Railway volume (`DB_PATH`). Tabellen: `works` (incl. `view_count INTEGER DEFAULT 0`, getoond in het admin panel), `tokens`.
- E-mail: Resend via `RESEND_API_KEY` env var. Alleen server-side, nooit in client-code.
- Analytics: Plausible, volledig geproxied via eigen domein (`GET /js/:file`, `POST /api/event`) zodat adblockers die op de `plausible.io`-hostnaam filteren de metingen niet skewen. Scripttag (`build/partials/analytics.html`) wordt via het buildsysteem op alle 7 unified-site-pagina's geïnjecteerd. De 3 magazine-reader-pagina's (`chasing-light`, `no-algorithm`, `origins`), `/on-view` en `/work/:slug` hebben elk een hand-onderhouden kopie van diezelfde scripttag (buiten het buildsysteem), gedekt door `build/check-analytics-drift.js` (`npm run check:analytics-drift`, ook onderdeel van `npm run build`) — een aparte checker naast `build/check-nav-drift.js`, niet een uitbreiding daarvan, omdat de twee partials structureel andere content bevatten om te vergelijken (nav-markup + toggle-knop/ARIA versus twee scripttags) en readers geen nav hebben. `/admin`, `/submit/:token` en `/hand-in/:token` hebben bewust geen Plausible: intern of token-gated, geen organisch publiek verkeer, geen analytische waarde als losse pageview zonder events. `/embed` heeft bewust geen Plausible: wordt nergens in deze codebase (of extern, voor zover bekend) daadwerkelijk ge-iframed — en is qua ontwerp een losstaande widget bedoeld voor inbedding in willekeurige host-pagina's, dus basis-pageviews daarbinnen zouden nooit betrouwbaar "bezoeken aan onze site" meten, ongeacht waar het ooit wordt ingebed.
- Custom events (Plausible, via `window.plausible('Event Name', { props: {...} })`): `Issue Opened` (bij laden van elke magazine-reader-pagina, prop `issue`), `PDF Downloaded` (klik op de downloadknop, alleen als er een PDF is, prop `issue`), `Print Order Clicked` (klik op de Peecho-link, prop `issue`) — alle drie in `public/magazine/{chasing-light,no-algorithm,origins}/index.html`. `Application Started` (klik op "Apply as a creative" naar Tally) in `build/pages/society.html`, geen extra props.

### API-routes (server.js)
- `GET  /js/:file` — proxy naar Plausible's scriptendpoint (`https://plausible.io/js/:file`); alleen `.js`-bestandsnamen toegestaan
- `POST /api/event` — proxy naar Plausible's event-API; forward't user-agent en het echte client-IP (`X-Forwarded-For`), accepteert elke Content-Type als JSON (Plausible's script stuurt vaak `text/plain` om een CORS-preflight te vermijden)
- `GET  /api/works` — alle niet-gearchiveerde werken
- `GET  /api/works/:slug` — enkel werk op slug
- `POST /api/contact` — contactformulier; volgorde: honeypot (`hp`-veld) → hCaptcha server-side verificatie → rate-limit 5 req/15 min per IP → Resend mail
- `GET  /api/tokens/:token` — valideert hand-in token, geeft `artist_name` terug
- `POST /hand-in/:token` — hand-in upload (multer/sharp), markeert token als used, stuurt bevestigingsmail naar artiest + notificatie naar admin
- `POST /api/submit` — publiek submit-formulier (SUBMIT_TOKEN vereist)
- `POST /api/admin/auth` — admin login, geeft sessie-token terug
- `GET  /api/admin/works` — alle werken (admin)
- `POST /api/admin/works` — werk toevoegen (admin)
- `PATCH /api/admin/works/:id` — status wijzigen (admin)
- `DELETE /api/admin/works/:id` — werk verwijderen (admin)
- `POST /api/admin/tokens` — hand-in token aanmaken voor artiest (admin); geeft `{ token, url }` terug

### Belangrijke regels
- `getinspiredmedia/on-view` (de oude losstaande app) en diens Railway project zijn gedecommissioned door de gebruiker (DNS, data, keys en repo verwijderd). Er zijn geen actieve verwijzingen naar die omgeving meer in deze codebase (bevestigd via repo-brede inventarisatie).
- `/on-view` is volledig uitgebouwd: standaard nav, roterende wand, plaque, progress-bar en wipe-transitie zijn aanwezig.
- Geen DNS-configuratie voor `getinspiredsociety.com` tot dit expliciet gevraagd wordt.
- Update deze sectie actief bij elke nieuwe architectuurbeslissing of configuratiewijziging.
