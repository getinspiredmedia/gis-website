# gis-website

Greenfield herbouw van de Get Inspired Society website.

Dit project was oorspronkelijk volledig losstaand van `getinspiredmedia/on-view`, een eerdere aparte app. Die is inmiddels gedecommissioned; er zijn geen gedeelde dependencies, databases of configuraties (geweest).

## Starten

```bash
npm install
npm start
```

## Paden

| Pad | Pagina |
|---|---|
| `/` | Home |
| `/on-view` | On View |
| `/on-view/leaderboard` | Tussenstand van de lopende ronde (top 10, willekeurige volgorde) |
| `/magazine` | Magazine |
| `/gallery` | Gallery |
| `/society` | Society |
| `/about` | About |
| `/contact` | Contact |
| `/support` | Support |

## Tijdelijke open-call hero

De homepage toont tijdelijk een oproep om mee te doen (`build/pages/index.html`, sectie `.callout`) in plaats van de hero met de current selection van On View. De oude hero staat ongewijzigd in `build/archive/hero-current-selection.html` (wordt niet gebouwd, met terugzetinstructie bovenaan).

## Deployment

Gedeployed via Railway. Auto-deploy op push naar `master`.
