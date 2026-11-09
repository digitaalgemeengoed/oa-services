# Wijzigingen

## 0.4.3 — 2026-11-09

`/gezondheid` noemt de versie van de diensten (voor de overzichtspagina).

## 0.4.2 — 2026-11-09

Volgt oa-contract 0.4.0.

## 0.4.1 — 2026-11-09

De plaatshouders in de geanonimiseerde weergave volgen het contract: `[PERSOON]`, `[ADRES]`, `[BSN]` …

## 0.4.0 — 2026-11-09

**Anonimiseren.** `POST /anonimiseren` zoekt persoonsgegevens in de html en geeft de platte tekst, de blokken (met plek) en de treffers terug; `POST /anonimiseren/toepassen` schermt de gekozen treffers af en geeft de html en de aantallen per soort terug. Leest en rekent alleen.

- De herkenning doet OpenAnonymiser van Conduction (Presidio, spaCy `nl_core_news_lg`, Nederlandse patronen), intern bereikbaar via `OPENANONYMISER_URL`. Zonder adres of bij storing: 503, niet stilletjes minder.
- Erbij: eigen patronen voor adressen (straat met huisnummer, postcode met plaats), de aanhef ("heer", "mevrouw") uit namen, en overlap weg (het langste en zekerste wint).
- Standaard afgeschermd: naam, adres, BSN, IBAN, telefoon, e-mail, kenteken, zaaknummer.
- Tests met een nagebootste herkenning; met `OPENANONYMISER_TEST_URL` ook tegen een echte OpenAnonymiser.

## 0.3.0 — 2026-11-08

Rekenbladen en presentaties. De adapter levert ze als secties (`<section data-oa="blad">` met de bladnaam als `<h2>`, `<section data-oa="dia">` met de titel als `<h2>`). Nieuwe regels: dia zonder titel (WCAG 2.4.2, met een vraag om de titel), dubbele titels, bladen met een standaardnaam (Blad1, Sheet1). Plekken noemen het blad of de dia. Voor bladen en dia's geen kopstructuur van een tekstdocument, en in een blad geen eis van een kopregel.

## 0.2.2 — 2026-11-08

Typefout uit 0.2.1 hersteld (de build faalde).

## 0.2.1 — 2026-11-08

Een onderstreepte link geeft niet langer het advies "onderstreepte tekst lijkt op een link".

## 0.1.0 — 2026-11-07

Fase 1 van het werkende prototype: contract, minimaal platform, integratielaag met twee ingangen, assistentkern, paneel en een demo-werkomgeving met de modules metadateren en toegankelijkheid.
