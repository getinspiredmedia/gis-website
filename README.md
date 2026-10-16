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

De hero op `/` kiest bij elke pageload zelf uit drie varianten (`build/pages/index.html`, geen deploy of handmatige actie nodig). De pagina vraagt `/api/on-view/round`, `/api/on-view/closing`, `/api/on-view/previous-winner` en `/api/works` tegelijk op, met één gezamenlijke deadline van 2,5 seconde; een antwoord dat faalt, te laat komt of de verkeerde vorm heeft telt als `null`.

1. **Actieve ronde:** de open-call hero (sectie `.callout`: "Show one work." / "Win a t-shirt.", knop naar `/submit`, link naar het leaderboard, shirt, feitenstrook). Is er een winnaar aangekondigd, dan komt daar op desktop een tweede kolom bij, op mobiel een kaart eronder, klikbaar naar `/work/:slug`; beeld nooit gecropt.
2. **Net gesloten ronde** (sectie `.closing`): geen actieve ronde, de laatst gesloten ronde is minder dan 7 dagen geleden gesloten (`GET /api/on-view/closing`) en er is een aangekondigde winnaar. Links de winnaarskaart ("Round M winner", titel, maker, de hele kaart linkt naar `/work/:slug`), rechts "Round N is closed.", "Winner announced soon. On View stays open." en de knop "Submit your work →" naar `/submit`. Is de aangekondigde winnaar die van de gesloten ronde zelf (M gelijk aan N), dan staat er alleen "On View stays open.". Een winnaar van een eerdere ronde (bijvoorbeeld ronde 3 terwijl ronde 4 net gesloten is) telt ook. Geen shirt, geen leaderboard-link, geen feitenstrook.
3. **Anders** (sectie `.open`): de current-selection hero. Het werk met status `current` schermvullend met caption, plus de knop "Submit your work →" naar `/submit`. Is er geen current werk, dan is het een effen ink hero met alleen die knop.

De keuze zit in de pure functie `chooseHeroVariant(round, closing, winner)`: een object met een ronde geeft variant 1, een closing-object plus een winnaar-object geeft variant 2, al het andere variant 3. Het venster van 7 dagen is de constante `CLOSING_WINDOW_DAYS` in `server.js`; na die 7 dagen valt de hero vanzelf terug op variant 3. De varianten wisselen nooit zichtbaar: alle blijven verborgen tot de keuze is gemaakt. Wordt er later weer een ronde aangemaakt, dan staat de open-call hero er vanzelf weer. `build/archive/hero-current-selection.html` is alleen nog een historisch exemplaar; `build/pages/index.html` is leidend.

## Ronde-winnaar

De winnaar van een ronde wordt handmatig gekozen, niet automatisch bepaald op views. Zodra een ronde `ready_for_winner` is, kiest André in `/admin` (tab Rounds) een werk uit de goedgekeurde werken van die ronde en bevestigt; daarmee wordt de winnaar eenmalig vastgelegd.

In dezelfde tab heeft elke ronde een uitklapbaar intern "Views leaderboard": alle goedgekeurde werken van die ronde met exacte views, meeste eerst. Dit is alleen voor de admin (`GET /api/admin/rounds/:round_number/leaderboard`, admin-sessie vereist) en staat los van het publieke `/on-view/leaderboard`, dat geshuffeld blijft en geen aantallen toont.

Dit interne leaderboard (en de winnaarsdropdown bij "Announce winner") tonen en sorteren op een **bevroren** aantal views (`view_count_at_archive`), niet op het doorlopende `view_count`: zodra een werk archiveert (7 dagen na `approved_at`) wordt zijn `view_count` op dat moment vastgezet. Zonder deze bevriezing zou een vroeg goedgekeurd (en dus vroeg gearchiveerd) werk oneerlijk lang extra views kunnen verzamelen via zijn nog altijd bereikbare `/work/:slug`-pagina, terwijl een laat goedgekeurd werk die extra tijd nooit krijgt. Niet-gearchiveerd werk (nog op de wand) toont gewoon zijn levende, groeiende `view_count`, dat werk is nog niet klaar. Bekende beperking: werk dat al vóór deze wijziging gearchiveerd was (met name ronde 1) heeft geen echt archiveringsmoment om op terug te vallen; die rijen kregen bij het uitrollen eenmalig hun `view_count` van dat moment als `view_count_at_archive` (best-effort, niet het exacte historische aantal). Het publieke `/on-view/leaderboard` en `/work/:slug` zelf zijn hierdoor niet veranderd.

### Sluitingsmail

Zodra `ends_at` van een ronde is gepasseerd, krijgt elke inzender met een goedgekeurd werk in die ronde één mail ("Round N is closed"). `rounds.closed_notification_sent_at` voorkomt dat de mail dubbel gaat; de check draait bij opstart en elk uur. Los van de winnaarsactie en van de archiefmail per werk.

## Inzendingen en mails

Alleen `/submit` (`POST /api/submit`) neemt inzendingen aan. De oude uitnodigingsflow `/hand-in/:token` is verwijderd: `/hand-in` en `/hand-in/:token` sturen door naar `/submit`, en de `tokens`-tabel wordt niet meer gebruikt (bewust niet gedropt). Alle door bezoekers ingevulde tekst wordt geescapet voordat ze in een HTML-mail komt, onderwerpen bevatten nooit regeleinden, en het portfolio moet een `http://`- of `https://`-link zijn; `/work/:slug` en `/admin` linken alleen zulke waarden.

## Deployment

Gedeployed via Railway. Auto-deploy op push naar `master`.
