# Status

## Huidige fase

Fase 1 — Project setup voltooid. Scaffold gepusht naar GitHub. Railway project actief.

## Wat is klaar

- Express scaffold met `server.js` en `package.json`
- 8 lege HTML-skeletten in `public/`
- `.gitignore`, `README.md`, `CLAUDE.md`, `docs/`
- GitHub repo `getinspiredmedia/gis-website` aangemaakt en gepusht naar `master`
- Railway project actief — intern: `gis-website.railway.internal`, publiek: `gis-website-production.up.railway.app`
- Railway auto-deploy geconfigureerd op push naar `master`
- Alle 8 paden geverifieerd op Railway (200) en `/foo` geeft 404
- `/on-view` roterende wand gebouwd: shuffle-bag, 20s cyclus, Plaque, progress-bar, arrows, statement
- `/work/:slug` werkdetailpagina gebouwd met statusregel (currently/previously on view)
- `prefers-reduced-motion` geïmplementeerd: rotatie stopt, pijlen blijven werken
- Mockdata: 10 werken in `public/data/works.json`

## Waar we mee bezig zijn

- Overige pagina's invullen (magazine, gallery, society, about, contact, support)

## Wat nog moet gebeuren

- Inhoud van de pagina's invullen (volgende taken)
- `/on-view` beslissing: restyled rebuild of proxy naar `on-view` app

## Bekende problemen

- Geen geautomatiseerde tests aanwezig
- `gis-project-brief.md` en `gis-design-system.md` ontbreken in de repo (nog aan te maken)
