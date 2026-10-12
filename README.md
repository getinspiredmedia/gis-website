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
| `/about` | About |
| `/contact` | Contact |
| `/support` | Support |

## Homepage-hero

De hero op `/` kiest bij elke pageload zelf, via `GET /api/on-view/round` (`build/pages/index.html`, geen deploy of handmatige actie nodig):

- **Actieve ronde:** de open-call hero (sectie `.callout`: "Show one work." / "Win a t-shirt.", knop naar `/submit`, link naar het leaderboard, shirt, feitenstrook). Zodra een winnaar is aangekondigd (`GET /api/on-view/previous-winner`) komt daar op desktop een tweede kolom bij, op mobiel een kaart eronder, klikbaar naar `/work/:slug`; beeld nooit gecropt. De winnaar verschijnt zodra in `/admin` op "Announce winner" is geklikt.
- **Geen actieve ronde** (geen rondes, alleen verleden of toekomstige rondes), een fout bij het ophalen of geen antwoord binnen 2,5 seconde: de current-selection hero (sectie `.open`): het werk met status `current` schermvullend met caption, plus de knop "Submit your work →" naar `/submit`. Is er geen current werk, dan is het een effen ink hero met alleen die knop.

De twee varianten wisselen nooit zichtbaar: beide blijven verborgen tot de keuze is gemaakt. Na ronde 4 hoeft er dus niets te gebeuren; wordt er later weer een ronde aangemaakt, dan staat de open-call hero er vanzelf weer. `build/archive/hero-current-selection.html` is alleen nog een historisch exemplaar; `build/pages/index.html` is leidend.

## Ronde-winnaar

De winnaar van een ronde wordt handmatig gekozen, niet automatisch bepaald op views. Zodra een ronde `ready_for_winner` is, kiest André in `/admin` (tab Rounds) een werk uit de goedgekeurde werken van die ronde en bevestigt; daarmee wordt de winnaar eenmalig vastgelegd.

In dezelfde tab heeft elke ronde een uitklapbaar intern "Views leaderboard": alle goedgekeurde werken van die ronde met exacte views, meeste eerst. Dit is alleen voor de admin (`GET /api/admin/rounds/:round_number/leaderboard`, admin-sessie vereist) en staat los van het publieke `/on-view/leaderboard`, dat geshuffeld blijft en geen aantallen toont.

Dit interne leaderboard (en de winnaarsdropdown bij "Announce winner") tonen en sorteren op een **bevroren** aantal views (`view_count_at_archive`), niet op het doorlopende `view_count`: zodra een werk archiveert (7 dagen na `approved_at`) wordt zijn `view_count` op dat moment vastgezet. Zonder deze bevriezing zou een vroeg goedgekeurd (en dus vroeg gearchiveerd) werk oneerlijk lang extra views kunnen verzamelen via zijn nog altijd bereikbare `/work/:slug`-pagina, terwijl een laat goedgekeurd werk die extra tijd nooit krijgt. Niet-gearchiveerd werk (nog op de wand) toont gewoon zijn levende, groeiende `view_count` — dat werk is nog niet klaar. Bekende beperking: werk dat al vóór deze wijziging gearchiveerd was (met name ronde 1) heeft geen echt archiveringsmoment om op terug te vallen; die rijen kregen bij het uitrollen eenmalig hun `view_count` van dat moment als `view_count_at_archive` (best-effort, niet het exacte historische aantal). Het publieke `/on-view/leaderboard` en `/work/:slug` zelf zijn hierdoor niet veranderd.

### Sluitingsmail

Zodra `ends_at` van een ronde is gepasseerd, krijgt elke inzender met een goedgekeurd werk in die ronde één mail ("Round N is closed"). `rounds.closed_notification_sent_at` voorkomt dat de mail dubbel gaat; de check draait bij opstart en elk uur. Los van de winnaarsactie en van de archiefmail per werk.

## Deployment

Gedeployed via Railway. Auto-deploy op push naar `master`.
