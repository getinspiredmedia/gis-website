# Beslissingen

## Formaat

Elke beslissing volgt dit formaat:

### [Datum] — [Onderwerp]
- **Beslissing:** ...
- **Reden:** ...
- **Alternatieven overwogen:** ...
- **Gevolgen:** ...

---

## Beslissingen

### 2026-07-29 — Express + statische bestanden als scaffold
- **Beslissing:** Node/Express met `express.static` voor de initiële scaffold.
- **Reden:** Minimale complexiteit voor een greenfield start; geen database of SSR nodig in deze fase.
- **Alternatieven overwogen:** Next.js, Astro — te vroeg voor die keuze.
- **Gevolgen:** Eenvoudig te migreren naar elk ander framework later.

### 2026-07-29 — `/on-view` als skelet, keuze uitgesteld
- **Beslissing:** `/on-view` is een leeg skelet; geen proxy of embed naar `getinspiredmedia/on-view`.
- **Reden:** De keuze (restyled rebuild vs. proxied Railway-app) is nog open.
- **Alternatieven overwogen:** Proxy via Express `http-proxy-middleware`, iframe embed.
- **Gevolgen:** Keuze moet expliciet gemaakt worden vóór invulling van `/on-view`.

### 2026-07-30 — On View herbouwen in deze repo (Option A)
- **Beslissing:** On View wordt volledig herbouwd in `getinspiredmedia/gis-website`. Geen proxy naar de aparte `getinspiredmedia/on-view` app.
- **Reden:** Één repo, één Railway deployment, één stack. Contact form via Resend vereist al een draaiende server — de backend-laag (SQLite, Sharp, Resend) wordt dan in diezelfde app ondergebracht.
- **Alternatieven overwogen:** Option B — proxy via `http-proxy-middleware` naar de bestaande On View Railway app.
- **Gevolgen:** SQLite (werken/inzendingen), Sharp (beeldverwerking), Resend (contact + hand-in notificaties), en de routes `/embed`, `/hand-in/:token`, `/submit`, `/admin` worden hier geïmplementeerd. De bestaande `getinspiredmedia/on-view` app blijft onaangeroerd en wordt niet gemigreerd of verwijderd.
