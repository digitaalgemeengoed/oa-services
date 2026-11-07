# oa-services

**Assistent-services** van de Office Assistent achter de lezende ingang. Lezen en rekenen, nooit vastleggen: deze dienst heeft geen database en geen opslag.

> Onderdeel van het werkende prototype van de Office Assistent. Een prototype, geen product.

## Toegankelijkheid beoordelen

`POST /toegankelijkheid` beoordeelt een html-document en geeft bevindingen terug met een plek en, waar het kan, een voorstel:

| Controle | Norm | Voorstel |
|---|---|---|
| Afbeelding zonder alternatieve tekst | WCAG 2.2 1.1.1 | vraagt de medewerker om een tekst |
| Eerste kop is geen kop 1; overgeslagen kopniveau; meer dan één kop 1 | WCAG 2.2 1.3.1 | vervanging met het juiste niveau |
| Vette alinea die eruitziet als een kop | WCAG 2.2 1.3.1 | vervanging door een kop |
| Tabel zonder kopcellen | WCAG 2.2 1.3.1 | vervanging met een kopregel |
| Alinea die begint met een opsommingsteken | WCAG 2.2 1.3.1 | advies |
| Vage linktekst ("hier", "lees meer"), link zonder tekst | WCAG 2.2 2.4.4 | vraagt een nieuwe linktekst |
| Lege kop; lang stuk zonder koppen | WCAG 2.2 2.4.6 | advies |
| Onderstreepte tekst | WCAG 2.2 1.3.1 | advies |

Een plek is een pad van elementindices, bijvoorbeeld `body/4/0`. De adapter vertaalt het naar wat de medewerker ziet. Andere formaten dan html volgen later.

Alleen de integratielaag mag de dienst aanroepen (gedeelde dienstsleutel).

## Gebruik

```
npm run build
DIENSTEN_DIENSTSLEUTEL=... npm start      # poort 4200
npm test
```

## Licentie

© 2026 Gemeente Haarlem. EUPL 1.2, zie `LICENSE`.

Gemaakt door Erik Hoekstra, programma-architect en senior consultant, afdeling i-Ontwikkeling, Gemeente Haarlem, met assistentie van Claude (Anthropic).
