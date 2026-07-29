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
    ├── on-view/index.html  # /on-view  ← roterende wand + plaque + progress
    ├── magazine/index.html # /magazine
    ├── gallery/index.html  # /gallery
    ├── society/index.html  # /society
    ├── about/index.html    # /about
    ├── contact/index.html  # /contact
    ├── support/index.html  # /support
    ├── work/index.html     # /work/:slug  ← shell, slug gelezen via JS
    └── data/works.json     # mockdata (10 werken)
```

### Buildcommando's
- `npm install` — dependencies installeren
- `npm start` — server starten (via `node server.js`)

### Testcommando's
- Nog geen geautomatiseerde tests. Handmatige verificatie via curl of browser.

### Linting & formatting
- Nog niet geconfigureerd.

### Typechecking
- Niet van toepassing (plain JavaScript, geen TypeScript).

### Architectuur
- Node/Express: `express.static` voor alle statische paden, daarna `/work/:slug` route.
- Elk hoofdpad heeft een eigen submap met `index.html` in `public/`.
- `/on-view` toont roterende wand (shuffle-bag, 20s) met Plaque en progress-bar.
- `/work/:slug` is een client-side shell: slug wordt gelezen uit de URL, werk opgezocht in `data/works.json`.
- Geen database, geen server-side rendering. Railway auto-deploy op push naar `master`.
- **Route-volgorde in server.js:** `express.static` eerst, daarna `/work/:slug`, geen catch-all.

### Belangrijke regels
- Raak `getinspiredmedia/on-view` of diens Railway project **nooit** aan vanuit dit project.
- De `/on-view` pagina is een skelet — de keuze "restyled rebuild vs. proxy" is nog niet gemaakt.
- Geen DNS-configuratie voor `getinspiredsociety.com` tot dit expliciet gevraagd wordt.
- Update deze sectie actief bij elke nieuwe architectuurbeslissing of configuratiewijziging.
