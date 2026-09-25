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

De hero heeft een tweede variant: zodra er een ronde-winnaar is aangekondigd (`GET /api/on-view/previous-winner`, opgehaald bij elke pageload) toont hij op desktop twee kolommen, links de open call en rechts de winnaar (klikbaar naar `/work/:slug`, beeld nooit gecropt); op mobiel staat de winnaarskaart onder de open-call content. Zonder aangekondigde winnaar blijft de volle-breedte hero staan. Geen herdeploy nodig: de winnaar verschijnt zodra in `/admin` op "Announce winner" is geklikt.

## Ronde-winnaar

De winnaar van een ronde wordt handmatig gekozen, niet automatisch bepaald op views. Zodra een ronde `ready_for_winner` is, kiest André in `/admin` (tab Rounds) een werk uit de goedgekeurde werken van die ronde en bevestigt; daarmee wordt de winnaar eenmalig vastgelegd.

In dezelfde tab heeft elke ronde een uitklapbaar intern "Views leaderboard": alle goedgekeurde werken van die ronde met exacte views, meeste eerst. Dit is alleen voor de admin (`GET /api/admin/rounds/:round_number/leaderboard`, admin-sessie vereist) en staat los van het publieke `/on-view/leaderboard`, dat geshuffeld blijft en geen aantallen toont.

### Sluitingsmail

Zodra `ends_at` van een ronde is gepasseerd, krijgt elke inzender met een goedgekeurd werk in die ronde één mail ("Round N is closed"). `rounds.closed_notification_sent_at` voorkomt dat de mail dubbel gaat; de check draait bij opstart en elk uur. Los van de winnaarsactie en van de archiefmail per werk.

## Deployment

Gedeployed via Railway. Auto-deploy op push naar `master`.
