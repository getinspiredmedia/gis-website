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
Dit project bevindt zich in de **initiële fase**. Er is nog geen code, framework, of configuratie aanwezig. De mapnaam `GIS-website` suggereert een webapplicatie voor geografische informatiesystemen (GIS).

### Frameworks & libraries
- Nog niet bepaald. Vul aan zodra de stack gekozen is.

### Projectstructuur
```
GIS-website/
└── CLAUDE.md          # Projectinstructies voor Claude
```
Vul aan zodra de mapstructuur opgezet is.

### Buildcommando's
- Nog niet geconfigureerd. Vul aan na project-setup.

### Testcommando's
- Nog niet geconfigureerd. Vul aan na project-setup.

### Linting & formatting
- Nog niet geconfigureerd. Vul aan na project-setup.

### Typechecking
- Nog niet geconfigureerd. Vul aan na project-setup.

### Architectuur
- Nog niet bepaald. Vul aan zodra de architectuur ontworpen is.

### Belangrijke regels
- Dit is een GIS-webapplicatie — houd rekening met zware geodata, kaartrendering en performance bij grote datasets.
- Update deze sectie actief bij elke nieuwe architectuurbeslissing, toegevoegd framework of configuratiewijziging.
- Houd buildcommando's, testcommando's en mapstructuur altijd gesynchroniseerd met de werkelijke projectstaat.
