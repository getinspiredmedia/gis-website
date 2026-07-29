# Status

## Huidige fase

Fase 1 — Project setup voltooid. Scaffold gepusht naar GitHub. Railway project actief.

## Wat is klaar

- Express scaffold met `server.js` en `package.json`
- 8 lege HTML-skeletten in `public/`
- `.gitignore`, `README.md`, `CLAUDE.md`, `docs/`
- GitHub repo `getinspiredmedia/gis-website` aangemaakt en gepusht naar `main`
- Lokaal getest: alle 8 paden geven 200, `/foo` geeft 404
- Railway project actief — intern adres: `gis-website.railway.internal`

## Waar we mee bezig zijn

- Publiek Railway-subdomein bevestigen en alle 8 paden verifiëren

## Wat nog moet gebeuren

- Publiek subdomein (`*.up.railway.app`) ophalen uit Railway-dashboard en documenteren
- Auto-deploy op push naar `main` bevestigen
- Verificatie van alle 8 paden op het publieke Railway-subdomein
- Inhoud van de pagina's invullen (volgende taken)
- `/on-view` beslissing: restyled rebuild of proxy naar `on-view` app

## Bekende problemen

- Geen geautomatiseerde tests aanwezig
- `gis-project-brief.md` en `gis-design-system.md` ontbreken in de repo (nog aan te maken)
