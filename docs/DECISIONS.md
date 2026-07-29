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
