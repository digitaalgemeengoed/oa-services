import { parseFragment, serialize } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { PII_SOORT, type AnonimiseerAntwoord, type PiiSoort, type Plek, type Treffer } from "@digitaalgemeengoed/oa-contract";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];
type TextNode = DefaultTreeAdapterMap["textNode"];

/**
 * Anonimiseren: persoonsgegevens vinden in de html van een stuk, en de
 * gekozen treffers afschermen. Leest en rekent alleen; vastleggen doet het
 * platform, nadat de medewerker heeft bevestigd.
 *
 * De herkenning zelf doet OpenAnonymiser (Conduction; Presidio met spaCy
 * nl_core_news_lg en Nederlandse patronen). Hier komt daar bij: adressen
 * (straat met huisnummer, postcode met plaats), wat OpenAnonymiser niet
 * vindt, en opschoning (aanhef uit een naam, overlap).
 *
 * De tekst gaat per blok (alinea, kop, cel, lijstitem) mee, gescheiden door
 * een lege regel, zodat de herkenning context heeft maar een treffer niet
 * over twee alinea's loopt. Elke treffer krijgt de plek van zijn blok.
 */

export const STANDAARD: PiiSoort[] = ["naam", "adres", "bsn", "iban", "telefoon", "e-mail", "kenteken", "zaaknummer"];

const VAN_MOTOR: Record<string, PiiSoort> = {
  PERSON: "naam",
  LOCATION: "plaats",
  ORGANIZATION: "organisatie",
  DATE_TIME: "datum",
  BSN: "bsn",
  IBAN: "iban",
  PHONE_NUMBER: "telefoon",
  EMAIL: "e-mail",
  LICENSE_PLATE: "kenteken",
  CASE_NO: "zaaknummer",
  ID_NO: "identiteitsbewijs",
  DRIVERS_LICENSE: "rijbewijs",
  KVK_NUMBER: "kvk-nummer",
  VAT_NUMBER: "btw-nummer",
  IP_ADDRESS: "ip-adres",
};
const ALLE_MOTOR = Object.keys(VAN_MOTOR);

/** Wat er in de geanonimiseerde tekst komt te staan (zonder nummer; het register nummert). */
export const LABEL = Object.fromEntries(Object.entries(PII_SOORT).map(([k, v]) => [k, `[${v.plaatshouder}]`])) as Record<PiiSoort, string>;

const BLOK = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "caption", "figcaption", "blockquote", "pre", "dt", "dd", "title"]);
const NIET_LEZEN = new Set(["script", "style", "template"]);

function isElement(n: Node): n is Element {
  return (n as Element).tagName !== undefined;
}

interface Stuk {
  knoop: TextNode;
  /** Positie in de platte tekst. */
  begin: number;
}

interface Kaart {
  wortel: DefaultTreeAdapterMap["documentFragment"];
  tekst: string;
  stukken: Stuk[];
  blokken: { begin: number; eind: number; plek: Plek }[];
}

const OMSCHRIJVING: Record<string, string> = {
  h1: "Kop",
  h2: "Kop",
  h3: "Kop",
  h4: "Kop",
  h5: "Kop",
  h6: "Kop",
  li: "Lijstitem",
  td: "Cel",
  th: "Kopcel",
  caption: "Bijschrift",
  figcaption: "Bijschrift",
};

/** De platte tekst van de html, met waar elk tekststuk en elk blok staat. */
export function lees(html: string): Kaart {
  const wortel = parseFragment(html);
  const stukken: Stuk[] = [];
  const blokken: Kaart["blokken"] = [];
  let tekst = "";
  let huidig: { pad: string; tag: string; begin: number } | null = null;
  let alinea = 0;

  const sluit = () => {
    if (!huidig) return;
    const inhoud = tekst.slice(huidig.begin);
    if (inhoud.trim()) {
      const n = huidig.tag === "p" ? `Alinea ${++alinea}` : (OMSCHRIJVING[huidig.tag] ?? "Tekst");
      blokken.push({ begin: huidig.begin, eind: tekst.length, plek: { pad: huidig.pad, beschrijving: n } });
    } else {
      tekst = tekst.slice(0, huidig.begin);
    }
    huidig = null;
  };
  const open = (pad: string, tag: string) => {
    sluit();
    if (tekst.length) tekst += "\n\n";
    huidig = { pad, tag, begin: tekst.length };
  };

  const loop = (ouder: ParentNode, pad: string, inBlok: boolean): void => {
    let i = 0;
    for (const n of ouder.childNodes) {
      if (isElement(n)) {
        const p = `${pad}/${i++}`;
        if (NIET_LEZEN.has(n.tagName)) continue;
        if (n.tagName === "br") {
          if (huidig) tekst += "\n";
          continue;
        }
        const blok = !inBlok && BLOK.has(n.tagName);
        if (blok) open(p, n.tagName);
        loop(n, p, inBlok || blok);
        if (blok) sluit();
      } else if (n.nodeName === "#text") {
        const t = (n as TextNode).value;
        if (!t) continue;
        if (!huidig) {
          if (!t.trim()) continue;
          open(pad, "p"); // losse tekst buiten een blok
        }
        stukken.push({ knoop: n as TextNode, begin: tekst.length });
        tekst += t;
        if (!inBlok) sluit();
      }
    }
  };
  loop(wortel, "body", false);
  sluit();
  return { wortel, tekst, stukken, blokken };
}

/* ---------- eigen patronen: adressen ---------- */

// Een straatnaam begint met een hoofdletter; daarna mogen tussenvoegsels ("Burgemeester van Reenensingel 5").
const STRAAT =
  /\b(?:[A-Z][\p{L}'.-]*\s(?:(?:van|de|der|den|het|ter|te|aan|[A-Z][\p{L}'.-]*)\s){0,3})?[A-Z][\p{L}'-]*(?:straat|weg|laan|plein|gracht|kade|dijk|singel|pad|steeg|hof|dreef|baan|park|markt|wal|veld|plantsoen|boulevard|burgwal|dam|haven|kwartier|ring|erf|hoek|zijde|straatweg)\s+\d{1,5}(?:\s?[a-zA-Z]\b|\s?-\s?\d{1,4}\b|\s(?:hs|bis|rd|zw)\b)?/gu;
const POSTCODE = /\b[1-9]\d{3}\s?(?!SA|SD|SS)[A-Z]{2}\b(?:\s+[A-Z][\p{L}'-]+(?:\s(?:aan\s(?:den|de|zee)|[A-Z][\p{L}'-]+))?)?/gu;
const AANHEF = /^(?:(?:de\s)?(?:heer|mevrouw|meneer|mevr\.?|dhr\.?|mr\.?|dr\.?|drs\.?|ing\.?|ir\.?|prof\.?)\s+)+/i;

interface Ruw {
  soort: PiiSoort;
  begin: number;
  eind: number;
  score: number;
  bron: Treffer["bron"];
}

export function eigenPatronen(tekst: string): Ruw[] {
  const uit: Ruw[] = [];
  for (const m of tekst.matchAll(STRAAT)) uit.push({ soort: "adres", begin: m.index!, eind: m.index! + m[0].length, score: 0.7, bron: "patroon" });
  for (const m of tekst.matchAll(POSTCODE)) uit.push({ soort: "adres", begin: m.index!, eind: m.index! + m[0].length, score: 0.7, bron: "patroon" });
  // Straat en postcode die bij elkaar horen ("Kruisweg 12, 2011 LB Haarlem"): één adres.
  uit.sort((a, b) => a.begin - b.begin);
  const samen: Ruw[] = [];
  for (const r of uit) {
    const vorige = samen.at(-1);
    if (vorige && /^[\s,]*$/.test(tekst.slice(vorige.eind, r.begin)) && !tekst.slice(vorige.eind, r.begin).includes("\n")) vorige.eind = Math.max(vorige.eind, r.eind);
    else samen.push({ ...r });
  }
  return samen;
}

/** Opschonen: aanhef uit namen, witruimte eraf, niet over een blokgrens, overlap weg (langste en zekerste wint). */
export function schoon(tekst: string, ruw: Ruw[]): Ruw[] {
  const bijgewerkt: Ruw[] = [];
  for (const r0 of ruw) {
    const r = { ...r0 };
    if (r.soort === "naam") {
      const m = tekst.slice(r.begin, r.eind).match(AANHEF);
      if (m) r.begin += m[0].length;
    }
    while (r.eind > r.begin && /\s/.test(tekst[r.eind - 1])) r.eind--;
    while (r.begin < r.eind && /\s/.test(tekst[r.begin])) r.begin++;
    const grens = tekst.slice(r.begin, r.eind).indexOf("\n\n");
    if (grens >= 0) r.eind = r.begin + grens;
    if (r.eind - r.begin < 2) continue;
    bijgewerkt.push(r);
  }
  // Langste eerst, dan de zekerste; wat overlapt met iets dat al gekozen is, valt weg.
  bijgewerkt.sort((a, b) => b.eind - b.begin - (a.eind - a.begin) || b.score - a.score);
  const gekozen: Ruw[] = [];
  for (const r of bijgewerkt) if (!gekozen.some((g) => r.begin < g.eind && g.begin < r.eind)) gekozen.push(r);
  return gekozen.sort((a, b) => a.begin - b.begin);
}

/* ---------- de herkenning ---------- */

export interface Motor {
  naam: string;
  analyseer(tekst: string): Promise<{ type: string; begin: number; eind: number; score: number }[]>;
}

export class MotorNietBeschikbaar extends Error {}

/** OpenAnonymiser (Conduction), alleen intern bereikbaar. */
export function openAnonymiser(adres: string, wachttijd = 20000): Motor {
  return {
    naam: "OpenAnonymiser (Presidio, spaCy nl_core_news_lg) met eigen patronen voor adressen",
    async analyseer(tekst) {
      let r: Response;
      try {
        r = await fetch(`${adres.replace(/\/$/, "")}/api/v1/analyze`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: tekst, language: "nl", entities: ALLE_MOTOR }),
          signal: AbortSignal.timeout(wachttijd),
        });
      } catch (e) {
        throw new MotorNietBeschikbaar(`OpenAnonymiser is niet bereikbaar: ${(e as Error).message}`);
      }
      if (!r.ok) throw new MotorNietBeschikbaar(`OpenAnonymiser antwoordde ${r.status}`);
      const j = (await r.json()) as { pii_entities?: { entity_type: string; start: number; end: number; score: number }[] };
      return (j.pii_entities ?? []).map((e) => ({ type: e.entity_type, begin: e.start, eind: e.end, score: e.score }));
    },
  };
}

export async function analyseer(html: string, motor: Motor): Promise<AnonimiseerAntwoord> {
  const kaart = lees(html);
  const model = kaart.tekst.trim() ? await motor.analyseer(kaart.tekst) : [];
  const ruw: Ruw[] = [
    ...model.filter((m) => VAN_MOTOR[m.type]).map((m) => ({ soort: VAN_MOTOR[m.type], begin: m.begin, eind: m.eind, score: m.score, bron: "model" as const })),
    ...eigenPatronen(kaart.tekst),
  ];
  const treffers: Treffer[] = schoon(kaart.tekst, ruw).map((r, i) => {
    const blok = kaart.blokken.find((b) => r.begin >= b.begin && r.begin < b.eind);
    return { id: `pii-${i + 1}`, soort: r.soort, tekst: kaart.tekst.slice(r.begin, r.eind), begin: r.begin, eind: r.eind, score: r.score, bron: r.bron, ...(blok ? { plek: blok.plek } : {}) };
  });
  return { tekst: kaart.tekst, blokken: kaart.blokken, treffers, standaard: STANDAARD, motor: motor.naam };
}

/**
 * De gekozen treffers afschermen. Leest de html opnieuw op dezelfde manier,
 * dus de posities kloppen; een treffer die over meer tekststukken loopt
 * (een naam half vet) krijgt het label in het eerste stuk, de rest valt weg.
 */
export function pasToe(html: string, treffers: { begin: number; eind: number; soort: PiiSoort }[]): { html: string; overzicht: Partial<Record<PiiSoort, number>> } {
  const kaart = lees(html);
  const geldig = schoon(
    kaart.tekst,
    treffers.filter((t) => LABEL[t.soort] && Number.isInteger(t.begin) && Number.isInteger(t.eind) && t.begin >= 0 && t.eind <= kaart.tekst.length && t.begin < t.eind).map((t) => ({ ...t, score: 1, bron: "medewerker" as const })),
  );
  const overzicht: Partial<Record<PiiSoort, number>> = {};
  for (const t of geldig) overzicht[t.soort] = (overzicht[t.soort] ?? 0) + 1;
  // Van achter naar voren, zodat posities binnen een stuk blijven kloppen.
  for (const t of [...geldig].reverse()) {
    let label = true;
    for (const s of kaart.stukken) {
      const eind = s.begin + s.knoop.value.length;
      if (eind <= t.begin || s.begin >= t.eind) continue;
      const van = Math.max(t.begin, s.begin) - s.begin;
      const tot = Math.min(t.eind, eind) - s.begin;
      const eerste = t.begin >= s.begin;
      s.knoop.value = s.knoop.value.slice(0, van) + (eerste && label ? LABEL[t.soort] : "") + s.knoop.value.slice(tot);
      if (eerste) label = false;
    }
  }
  return { html: serialize(kaart.wortel), overzicht };
}
