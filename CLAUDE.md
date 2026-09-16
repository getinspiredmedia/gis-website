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
- `npm install` — dependencies installeren. **Let op:** `package-lock.json` staat bewust in `.gitignore` (sinds de fix van 2026-07-30, "revert better-sqlite3 to v9.6 and drop lockfile to fix Railway segfault") omdat een lockfile gegenereerd op de ene combinatie van OS/Node-versie een native module (`better-sqlite3`) kan vastzetten op een prebuilt binary die op een andere combinatie (bv. Railway's Linux/Node 20) direct crasht. Een lokaal gegenereerd `package-lock.json` dat per ongeluk een nieuwere major binnenhaalt dan `package.json`'s `^9.6.0` toestaat, wordt dus **nooit** door `git status` als wijziging gesignaleerd — controleer bij twijfel over een lokale segfault in `new Database(...)` eerst `require('better-sqlite3/package.json').version` tegen `engines.node` (`20.x`), niet alleen de git-diff.
- `npm run build` — regenereer `public/` uit `build/pages/` (altijd uitvoeren na aanpassing build-bronnen)
- `npm start` — server starten via `exec node server.js`. De `exec` is bewust: zonder die vervangt npm's scriptrunner zichzelf niet door het node-proces, waardoor een `SIGTERM` (die Railway bij élke herdeploy stuurt, niet alleen bij een echte crash) de tussenliggende shell doodt zónder hem door te geven aan de node-child — die blijft dan verweesd draaien terwijl npm een non-zero exit logt (`npm error signal SIGTERM`), wat Railway als "Deploy Crashed" rapporteert. Met `exec` ontvangt `server.js` het signaal zelf en sluit netjes af via de graceful-shutdown-handler (SIGTERM/SIGINT → `server.close()` laat lopende requests afronden → `db.close()` → `process.exit(0)`, met een 10s force-exit-timeout als fallback).
  - Verificatie-deploy: 2026-08-01, controle-deploy getriggerd om te bevestigen dat een nieuwe container-swap met deze fix schoon verloopt (geen `npm error signal SIGTERM`, wel `Graceful shutdown gestart` in de logs). Zie André's handmatige bevestiging in Railway voor het definitieve resultaat.

### Testcommando's
- `npm run test:view-count` — dedup/rate-limit/cleanup op `/work/:slug`, scraper-UA-uitsluiting, admin `view_count`/`raw_views`
- `npm run test:archive-email` — `archiveOldWorks()` + archiveringsmail
- `npm run test:review-status` — hand-in en `/api/submit` starten allebei als `pending`, approve/reject, zichtbaarheid op de drie publieke routes, migratie van bestaande rijen naar `approved`, en dat de 7-dagen-wandtermijn vanaf `approved_at` loopt (niet vanaf `created_at`)
- `npm run test:submit-public` — `/submit` laadt zonder token, hCaptcha/honeypot-afdwinging, `allowSubmit`-rate limiter, de duplicate-check-bugfix (een eerder `rejected` e-mailadres kan opnieuw indienen), en dat `/submit/:token` naar `/submit` redirect voor elke tokenwaarde
- `npm run test:og-tags` — OG/Twitter-tags en `/og-image/:slug`
- `npm run test:plausible-proxy` — Plausible-analyticsproxy
- `npm run test:nav-drift-aria` / `npm run test:analytics-drift` — regressietests voor de drift-checkers zelf
- Elk testbestand spawnt de echte server tegen een wegwerp-DB (`node test/*.test.js`, patroon in `test/`); geen testrunner-package, gewoon Node.

### Linting & formatting
- Nog niet geconfigureerd.

### Typechecking
- Niet van toepassing (plain JavaScript, geen TypeScript).

### Architectuur
- Node/Express: `express.static` voor alle statische paden, daarna specifieke page-routes.
- Elk hoofdpad heeft een eigen submap met `index.html` in `public/`.
- `/on-view` toont roterende wand (shuffle-bag, 20s) met Plaque en progress-bar. Gebruikt de standaard nav (mark-logo + Magazine/Gallery/Society/Log in) inclusief scroll-shrink en wipe-transitie.
- `/work/:slug` rendert server-side (DB-lookup op slug, incl. OG/Twitter-tags, zie hieronder) en hoogt bij een bezoek aan een bestaande, **`review_status='approved'`** slug `works.view_count` met 1 op — maximaal één keer per bezoeker per werk per 24 uur (zie "View counting" hieronder). Een onbekende slug, of een slug die (nog) niet approved is, hoogt niets op en maakt geen rij aan — zie "Goedkeuringsflow" hieronder. Bekende OG-preview-scrapers (`SCRAPER_USER_AGENTS` in `server.js`: Facebook/Instagram (gedeelde `facebookexternalhit`-UA), Twitter/X, WhatsApp, LinkedIn, Slack, Discord, Telegram, case-insensitieve substring-match) tellen niet mee — pagina en OG-tags blijven voor hen wel normaal renderen. Onbekende/ontbrekende user-agent telt wél mee (fail-open). Bewust géén losse `tiktok`/`instagram`-substrings toegevoegd: hun in-app browsers dragen datzelfde merkwoord ook in hun UA voor gewone menselijke bezoeken (niet alleen voor link-preview scraping), dus zo'n substring zou echte via die apps doorverwezen bezoekers laten meetellen als scraper. Facebook/Instagram's eigen OG-crawler is al gedekt via `facebookexternalhit`.
- **View counting** (`work_views`-tabel, epic 1 van `on-view-open-call-backlog.md`): elke rij is één (`work_id`, `visitor_hash`, `viewed_at`). `visitor_hash` is `sha256(VISITOR_HASH_SALT + '|' + ip + '|' + user-agent)` — de env var `VISITOR_HASH_SALT` bevat de salt, het IP-adres zelf wordt nergens leesbaar opgeslagen. Bij een bezoek aan `/work/:slug` wordt `work_views` + `works.view_count` alleen bijgewerkt als er nog geen rij voor die exacte `visitor_hash` + `work_id` binnen de laatste 24 uur bestaat. Een aparte IP-gebaseerde rate limiter (`allowWorkView`, zelfde sliding-window-patroon als `allowContact`: max 20 requests/60s per IP) begrenst daarnaast hoeveel requests van één IP nog mee kunnen tellen, ongeacht user-agent — dat vangt een script dat de 24u-dedup zou omzeilen door elke request een andere user-agent te geven. De rate limiter blokkeert alleen het tellen, nooit de pagina zelf (altijd 200). Een dagelijkse opschoontaak (`cleanupOldViews()`, draait bij opstart en daarna elke 24 uur via `setInterval`, zelfde patroon als `archiveOldWorks()`) verwijdert `work_views`-rijen ouder dan 30 dagen — rolling window, niet gekoppeld aan een ronde-sluiting. Admin (`GET /api/admin/works`) toont zowel `view_count` (gededupliceerd) als `raw_views` (totaal aantal rijen in `work_views` voor dat werk, via subquery).
- **Goedkeuringsflow** (`works.review_status`, epic 2 van `on-view-open-call-backlog.md`): apart van het bestaande lifecycle-veld `status` (current/previous/archived, dat de 7-dagen-wandcyclus stuurt) heeft `works` nu ook `review_status` (`pending`/`approved`/`rejected`, default `approved`) en `approved_at` (nullable, gezet op het moment van goedkeuring). Beide inzendpaden — `POST /hand-in/:token` én `POST /api/submit` — zetten expliciet `review_status='pending'` (los van de bestaande lifecycle-status, die nog steeds meteen op `'previous'` start — een werk kan dus tegelijk `previous` én `pending` zijn). `/submit` is sinds epic 3 volledig publiek (geen `SUBMIT_TOKEN` meer, die env var en elke check erop zijn verwijderd) — zie "Publieke inzendpagina" hieronder voor hoe dat beveiligd is. Alle publieke routes filteren op `review_status='approved'`: `GET /api/works` (wandlijst, gebruikt door `/on-view` en `/embed`), `GET /api/works/:slug` (client-side data voor `/work/:slug`) en de server-side `GET /work/:slug` zelf (OG-tags + view counting) — een pending of rejected werk gedraagt zich overal identiek aan een onbekende slug (404 op de twee `/api/*`-routes, de bestaande "Work not found" OG-pagina op `/work/:slug`). `archiveOldWorks()` archiveert alleen nog rijen met `review_status='approved'`, en meet de 7-dagen-wandtermijn vanaf **`approved_at`** (met `COALESCE(approved_at, created_at)` als fallback voor rijen die vóór deze migratie al `approved` waren en dus geen `approved_at` hebben) — niet vanaf `created_at`. Zou de termijn vanaf `created_at` blijven lopen, dan zou een inzending die dagen op review wacht een verkorte of zelfs geen zichtbare periode op de wand krijgen na goedkeuring; met `approved_at` als basis begint de volle 7 dagen pas te lopen op het moment van daadwerkelijke goedkeuring. Bestaande rijen van vóór deze migratie krijgen via een `ALTER TABLE ... DEFAULT 'approved'` met terugwerkende kracht `review_status='approved'`; hun `approved_at` blijft `NULL` (niet met terugwerkende kracht te reconstrueren), vandaar de `COALESCE`-fallback naar `created_at` juist voor die rijen. Nieuwe admin-routes: `POST /api/admin/works/:id/approve` (zet `approved`, stempelt `approved_at`) en `POST /api/admin/works/:id/reject` (zet `rejected`). Admin (`/admin`) toont drie tabs met live tellers — Pending / Approved / Rejected — Pending heeft alleen approve/reject-acties, Approved is de bestaande wandtabel (nu gefilterd op `review_status='approved'`), Rejected toont alleen een Delete-actie.
- **Publieke inzendpagina** (`/submit`, epic 3 van `on-view-open-call-backlog.md`): `GET /submit` is sinds deze epic publiek en tokenloos — `express.static` serveert `public/submit/index.html` gewoon zoals elke andere pagina (de eerdere blokkerende route `app.get('/submit', ...)` die zonder token altijd 404 gaf, is verwijderd). Beveiliging tegen misbruik nu het gedeelde token wegvalt: hCaptcha (zelfde site key als het contactformulier, `0a7267b2-d53c-4d0a-b414-cbce7aeaba72`) + honeypot-veld (`hp`) op `POST /api/submit`, zelfde volgorde en patroon als `/api/contact` (honeypot → captcha-aanwezigheid → captcha-verificatie → rate limit → veldvalidatie), plus een losse `allowSubmit`-rate limiter (eigen `Map`, zelfde 5 req/15 min als `allowContact`, bewust niet gedeeld met het contactformulier zodat de twee acties geen quotum delen). `GET /submit/:token` blijft bestaan als 301-redirect naar `/submit` voor **elke** waarde van `token` — bestaande gedeelde links (o.a. in gis-scout outreach-mails) blijven zo werken, de tokenwaarde zelf wordt nergens meer gecontroleerd. De env var `SUBMIT_TOKEN` en elke referentie ernaar (ook in de archiveringsmail-CTA, die nu gewoon naar `/submit` linkt) zijn verwijderd uit `server.js`. **Duplicate-check bugfix:** de check die een tweede inzending vanaf hetzelfde e-mailadres blokkeert, keek voorheen alleen naar de lifecycle-status (`status!='archived'`) — een `rejected` werk krijgt nooit een lifecycle-verandering, dus dat blokkeerde een makers e-mailadres *permanent*. De check is nu beperkt tot `review_status IN ('pending','approved')`: alleen een nog actieve inzending (in review of al op de wand) telt als "blokkade"; een afgewezen inzending is een afgeronde uitkomst en mag een nieuwe poging nooit in de weg zitten. Geen cooldown-periode toegevoegd — dat voegde ongevraagde complexiteit toe zonder duidelijk voordeel boven direct opnieuw mogen proberen, gezien admin sowieso élke nieuwe inzending opnieuw beoordeelt. Field- en Button-styling op `public/submit/index.html` gecorrigeerd naar de daadwerkelijke design-system-componenten (zie `docs/gis-design-system.md` §4): focusrand nu `--blue` (was `--ink`), knop nu een outlined pill die op hover vult (was een gevulde blauwe pill, wat afweek van "geen gevulde primary button behalve de log-in pill"). Sinds een latere fix heeft `/submit` ook standaard Plausible-pageviewtracking (zie Analytics en "Custom events" hieronder) en beschrijft `/privacy` dat `/submit` dezelfde in-memory, niet-gehashte, niet-persistente rate limiting gebruikt als het contactformulier.
- `/privacy` (via buildsysteem, `build/pages/privacy.html`) legt in gewone taal uit dat IP-adressen gehasht worden gebruikt om nepweergaven op werkpagina's te herkennen en dat het contactformulier IP gebruikt voor rate limiting. Bereikbaar via de "Privacy"-link in de gedeelde footer (`build/partials/footer.html`) op alle 7 buildsysteem-pagina's inclusief homepage — dit is de enige toegestane footer-wijziging op die pagina's voor deze taak. Tekst is **niet juridisch gecontroleerd**.
- `archiveOldWorks()` zet werk van `previous` naar `archived` zodra het 7 dagen oud is (draait bij server-start en daarna elk uur via `setInterval`). Sinds 2026-08-20 mailt dit per gearchiveerd werk de maker (`works.email`) via het bestaande Resend-patroon: onderwerp "Your work has come down from On View", met link naar de blijvende `/work/:slug`-pagina en een re-engagement-CTA naar `/submit` (sinds epic 3 de publieke, tokenloze inzendpagina — zie "Publieke inzendpagina" hieronder). De `UPDATE ... RETURNING` pakt alleen rijen die nog `status='previous'` zijn, dus een werk wordt precies één keer gearchiveerd en gemaild — een serverherstart binnen hetzelfde uur triggert geen dubbele mail, er is geen aparte `email_sent`-vlag nodig. De per-maker `/hand-in/:token` is uniek maar eenmalig (`tokens.used`), en is dus niet bruikbaar als herhaalbare CTA — vandaar de link naar het nu-publieke `/submit` in plaats daarvan.
- **Route-volgorde in server.js:** `express.static` eerst, daarna page-routes (`/work/:slug`, `/submit/:token`, `/hand-in/:token`), geen catch-all.
- Database: better-sqlite3 in WAL-modus op Railway volume (`DB_PATH`). Tabellen: `works` (incl. `view_count INTEGER DEFAULT 0`, `review_status`/`approved_at`, zie hierboven), `tokens`, `work_views` (zie "View counting" hierboven).
- E-mail: Resend via `RESEND_API_KEY` env var. Alleen server-side, nooit in client-code.
- Analytics: Plausible, volledig geproxied via eigen domein (`GET /js/:file`, `POST /api/event`) zodat adblockers die op de `plausible.io`-hostnaam filteren de metingen niet skewen. Scripttag (`build/partials/analytics.html`) wordt via het buildsysteem op alle 7 unified-site-pagina's geïnjecteerd. De 3 magazine-reader-pagina's (`chasing-light`, `no-algorithm`, `origins`), `/on-view`, `/work/:slug` én (sinds epic 3) `/submit` hebben elk een hand-onderhouden kopie van diezelfde scripttag (buiten het buildsysteem), gedekt door `build/check-analytics-drift.js` (`npm run check:analytics-drift`, ook onderdeel van `npm run build`, `HAND_MAINTAINED_COPIES` bevat nu 6 pagina's) — een aparte checker naast `build/check-nav-drift.js`, niet een uitbreiding daarvan, omdat de twee partials structureel andere content bevatten om te vergelijken (nav-markup + toggle-knop/ARIA versus twee scripttags) en readers geen nav hebben. `/admin` en `/hand-in/:token` hebben bewust geen Plausible: intern resp. token-gated, geen organisch publiek verkeer, geen analytische waarde als losse pageview zonder events. `/submit` kreeg tot epic 3 nog geen Plausible, met dezelfde onderbouwing ("token-gated, geen organisch publiek verkeer") — die klopte al niet meer zodra de pagina publiek werd, aangezien ze juist bedoeld is om organisch publiek verkeer vanuit de open-call-campagne op social media te ontvangen en dat verkeer meetbaar moet zijn tegen een baseline. Deze inconsistentie is inmiddels opgelost: `/submit` heeft nu dezelfde standaard pageview-tracking als de andere publieke pagina's. `/embed` heeft bewust geen Plausible: wordt nergens in deze codebase (of extern, voor zover bekend) daadwerkelijk ge-iframed — en is qua ontwerp een losstaande widget bedoeld voor inbedding in willekeurige host-pagina's, dus basis-pageviews daarbinnen zouden nooit betrouwbaar "bezoeken aan onze site" meten, ongeacht waar het ooit wordt ingebed.
- Custom events (Plausible, via `window.plausible('Event Name', { props: {...} })`): `Issue Opened` (bij laden van elke magazine-reader-pagina, prop `issue`), `PDF Downloaded` (klik op de downloadknop, alleen als er een PDF is, prop `issue`), `Print Order Clicked` (klik op de Peecho-link, prop `issue`) — alle drie in `public/magazine/{chasing-light,no-algorithm,origins}/index.html`. `Application Started` (klik op "Apply as a creative" naar Tally) in `build/pages/society.html`, geen extra props. **Uitgezocht en expliciet vastgelegd (epic 3):** dit event hoort bij de Society-lidmaatschapsflow (de externe Tally-form op `/society`), niet bij de wekelijkse On View-inzendflow — `/submit` heeft dus alleen de standaard pageview, geen `Application Started` en geen ander custom event. `/submit` heeft op dit moment geen eigen custom event voor een geslaagde inzending; een event als `Work Submitted` (gevuurd bij een 200-response van `POST /api/submit`, geen extra props nodig) zou zinvol kunnen zijn om paginabezoeken tegen daadwerkelijke inzendingen af te zetten, maar is bewust niet gebouwd — niet gevraagd in deze epic.

### API-routes (server.js)
- `GET  /js/:file` — proxy naar Plausible's scriptendpoint (`https://plausible.io/js/:file`); alleen `.js`-bestandsnamen toegestaan
- `POST /api/event` — proxy naar Plausible's event-API; forward't user-agent en het echte client-IP (`X-Forwarded-For`), accepteert elke Content-Type als JSON (Plausible's script stuurt vaak `text/plain` om een CORS-preflight te vermijden)
- `GET  /api/works` — alle niet-gearchiveerde, goedgekeurde (`review_status='approved'`) werken
- `GET  /api/works/:slug` — enkel werk op slug, alleen als `review_status='approved'` (anders 404, zelfde als een onbekende slug)
- `POST /api/contact` — contactformulier; volgorde: honeypot (`hp`-veld) → hCaptcha server-side verificatie → rate-limit 5 req/15 min per IP → Resend mail
- `GET  /api/tokens/:token` — valideert hand-in token, geeft `artist_name` terug
- `POST /hand-in/:token` — hand-in upload (multer/sharp), markeert token als used, maakt het werk aan met `review_status='pending'`, stuurt bevestigingsmail naar artiest ("we laten je weten zodra het op de wand komt") + notificatiemail naar admin ("pending your approval", link naar `/admin`)
- `POST /api/submit` — publiek submit-formulier, gedekt door hCaptcha + honeypot + `allowSubmit`-rate limiter (zelfde patroon als `/api/contact`, zie "Publieke inzendpagina" hierboven); maakt het werk aan met `review_status='pending'`, stuurt "pending approval"-mail naar admin + bevestigingsmail naar artiest (zelfde patroon als `/hand-in/:token`); duplicate-check blokkeert alleen op een nog actieve (`pending`/`approved`) inzending, nooit op een `rejected` inzending
- `POST /api/admin/auth` — admin login, geeft sessie-token terug
- `GET  /api/admin/works` — alle werken, ongeacht `review_status` (admin ziet ook pending/rejected); elke rij bevat ook `raw_views` (aantal rijen in `work_views` voor dat werk), naast het gededupliceerde `view_count`
- `POST /api/admin/works` — werk toevoegen (admin); geen `review_status` opgegeven → kolom-default `approved` (een rechtstreeks door admin toegevoegd werk hoeft niet zichzelf goed te keuren)
- `PATCH /api/admin/works/:id` — lifecycle-status wijzigen (current/previous/archived, admin)
- `DELETE /api/admin/works/:id` — werk verwijderen (admin)
- `POST /api/admin/works/:id/approve` — zet `review_status='approved'`, stempelt `approved_at` (admin)
- `POST /api/admin/works/:id/reject` — zet `review_status='rejected'` (admin)
- `POST /api/admin/tokens` — hand-in token aanmaken voor artiest (admin); geeft `{ token, url }` terug
- `GET  /submit` — publieke inzendpagina (geen token), geserveerd door `express.static` zoals elke andere pagina
- `GET  /submit/:token` — 301-redirect naar `/submit` voor elke waarde van `token`; bestaande gedeelde links blijven zo werken

### Belangrijke regels
- `getinspiredmedia/on-view` (de oude losstaande app) en diens Railway project zijn gedecommissioned door de gebruiker (DNS, data, keys en repo verwijderd). Er zijn geen actieve verwijzingen naar die omgeving meer in deze codebase (bevestigd via repo-brede inventarisatie).
- `/on-view` is volledig uitgebouwd: standaard nav, roterende wand, plaque, progress-bar en wipe-transitie zijn aanwezig.
- Geen DNS-configuratie voor `getinspiredsociety.com` tot dit expliciet gevraagd wordt.
- Update deze sectie actief bij elke nieuwe architectuurbeslissing of configuratiewijziging.
