import { parseFragment, serializeOuter } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import type { Bevinding, Plek } from "@digitaalgemeengoed/oa-contract";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];

/**
 * Beoordeelt de toegankelijkheid van een html-document. Leest alleen en
 * geeft bevindingen terug met een plek en, waar het kan, een voorstel.
 * Er ontstaat geen gebeurtenis.
 *
 * Plekken zijn paden van elementindices vanaf de wortel van het document
 * ("body/0/2" = derde element in het eerste element). De adapter vertaalt
 * zo'n pad naar wat de medewerker ziet.
 *
 * Een rekenblad of presentatie levert de adapter als reeks secties:
 * <section data-oa="blad"> met de bladnaam als <h2>, en
 * <section data-oa="dia"> met de titel van de dia als <h2> (geen <h2> =
 * geen titel). Daar gelden eigen regels; de kopstructuur van een
 * tekstdocument niet.
 */
export const GECONTROLEERD = [
  "WCAG 2.2 1.1.1 Niet-tekstuele content",
  "WCAG 2.2 1.3.1 Info en relaties",
  "WCAG 2.2 2.4.2 Paginatitel (titels van dia's)",
  "WCAG 2.2 2.4.4 Linkdoel (in context)",
  "WCAG 2.2 2.4.6 Koppen en labels",
];

/** Namen die een rekenblad krijgt als niemand het een naam gaf. */
const STANDAARD_BLADNAAM = /^(blad|sheet|tabel|tabelle|feuil|feuille|hoja|foglio|planilha|arkusz)\s*\d+$/i;

const VAGE_LINKTEKSTEN = new Set(["hier", "klik hier", "klik", "lees meer", "meer", "link", "deze link", "via deze link", "zie hier"]);

function isElement(n: Node): n is Element {
  return (n as Element).tagName !== undefined;
}

function elementKinderen(n: ParentNode): Element[] {
  return n.childNodes.filter(isElement);
}

function tekst(n: Node): string {
  if (n.nodeName === "#text") return (n as DefaultTreeAdapterMap["textNode"]).value;
  if ("childNodes" in n) return (n as ParentNode).childNodes.map(tekst).join("");
  return "";
}

function attr(e: Element, naam: string): string | undefined {
  return e.attrs.find((a) => a.name === naam)?.value;
}

function heeftAttr(e: Element, naam: string): boolean {
  return e.attrs.some((a) => a.name === naam);
}

const KOPNIVEAU: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

function kort(s: string, n = 40): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Zelfde element met een andere tag; inhoud en attributen blijven. */
function metTag(e: Element, tag: string): string {
  const kopie: Element = { ...e, tagName: tag, nodeName: tag };
  return serializeOuter(kopie);
}

export function beoordeelHtml(html: string): Bevinding[] {
  const wortel = parseFragment(html);
  const bevindingen: Bevinding[] = [];
  let teller = 0;
  const nieuw = (b: Omit<Bevinding, "id" | "module">): void => {
    bevindingen.push({ id: `tg-${++teller}`, module: "toegankelijkheid", ...b });
  };

  const koppen: { niveau: number; e: Element; plek: Plek }[] = [];
  const dias: { titel: string; pad: string; kopPad: string | null; wie: string }[] = [];
  const bladen: { titel: string; pad: string; kopPad: string | null; wie: string }[] = [];
  let alineas = 0;

  const loop = (ouder: ParentNode, pad: string, beschrijvingOuder: string): void => {
    elementKinderen(ouder).forEach((e, i) => {
      const p = `${pad}/${i}`;
      const t = tekst(e).replace(/\s+/g, " ").trim();
      const plek = (wat: string): Plek => ({ pad: p, beschrijving: wat + beschrijvingOuder });
      const tag = e.tagName;

      if (tag === "section" && (attr(e, "data-oa") === "dia" || attr(e, "data-oa") === "blad")) {
        const soort = attr(e, "data-oa")!;
        const eerste = elementKinderen(e)[0];
        const titel = eerste && eerste.tagName in KOPNIVEAU ? tekst(eerste).replace(/\s+/g, " ").trim() : "";
        const nummer = (soort === "dia" ? dias : bladen).length + 1;
        const wie = soort === "dia" ? `Dia ${nummer}` : `Blad "${kort(titel || String(nummer))}"`;
        (soort === "dia" ? dias : bladen).push({ titel, pad: p, kopPad: eerste && eerste.tagName in KOPNIVEAU ? `${p}/0` : null, wie });
        // Binnen een sectie: de plek noemt het blad of de dia.
        loop(e, p, ` · ${wie}`);
        return;
      }

      if (tag in KOPNIVEAU && beschrijvingOuder.startsWith(" · ")) {
        // De titel van een dia of de naam van een blad: geen kopstructuur.
        return;
      }

      if (tag in KOPNIVEAU) {
        const pl = plek(`Kop "${kort(t)}"`);
        koppen.push({ niveau: KOPNIVEAU[tag], e, plek: pl });
        if (!t) nieuw({ ernst: "fout", regel: "WCAG 2.2 2.4.6", melding: "Deze kop is leeg.", plek: pl, voorstel: { beschrijving: "Verwijder de lege kop of geef haar tekst." } });
      }

      if (tag === "p") {
        alineas++;
        // Een alinea die alleen uit vet bestaat, is vaak een kop die geen kop is.
        const kinderen = e.childNodes.filter((k) => !(k.nodeName === "#text" && !tekst(k).trim()));
        const alleenVet = kinderen.length === 1 && isElement(kinderen[0]) && ["strong", "b"].includes(kinderen[0].tagName);
        if (alleenVet && t.length > 0 && t.length <= 80 && !/[.:;]$/.test(t)) {
          nieuw({
            ernst: "waarschuwing",
            regel: "WCAG 2.2 1.3.1",
            melding: `"${kort(t)}" ziet eruit als een kop, maar is opgemaakt als vette tekst. Een schermlezer hoort geen kop.`,
            plek: plek(`Alinea "${kort(t)}"`),
            voorstel: { beschrijving: "Maak er een kop van.", vervanging: `<h2>${escape(t)}</h2>` },
          });
        }
        if (/^\s*([-•*–]|\d+[.)])\s+/.test(t)) {
          nieuw({
            ernst: "advies",
            regel: "WCAG 2.2 1.3.1",
            melding: "Deze alinea begint met een opsommingsteken. Een echte lijst is voor een schermlezer herkenbaar als lijst.",
            plek: plek(`Alinea "${kort(t)}"`),
            voorstel: { beschrijving: "Gebruik de lijstfunctie van de tekstverwerker." },
          });
        }
      }

      if (tag === "img") {
        if (!heeftAttr(e, "alt")) {
          const bron = attr(e, "src") ?? "";
          const naam = bron.startsWith("data:") ? "" : ` (${kort(bron.split("/").pop() ?? "", 30)})`;
          nieuw({
            ernst: "fout",
            regel: "WCAG 2.2 1.1.1",
            melding: "Deze afbeelding heeft geen alternatieve tekst.",
            plek: plek(`Afbeelding${naam}`),
            voorstel: {
              beschrijving: "Beschrijf wat de afbeelding laat zien. Is zij alleen versiering, laat de tekst dan leeg.",
              vraag: { label: "Alternatieve tekst", veld: "alt" },
            },
          });
        }
      }

      if (tag === "a") {
        const doel = attr(e, "href");
        if (doel !== undefined) {
          const label = t || elementKinderen(e).filter((k) => k.tagName === "img").map((k) => attr(k, "alt") ?? "").join(" ").trim();
          if (!label) {
            nieuw({ ernst: "fout", regel: "WCAG 2.2 2.4.4", melding: "Deze link heeft geen tekst.", plek: plek("Link zonder tekst"), voorstel: { beschrijving: "Geef de link een tekst die zegt waar hij heen gaat." } });
          } else if (VAGE_LINKTEKSTEN.has(label.toLowerCase().replace(/[.!]$/, ""))) {
            nieuw({
              ernst: "waarschuwing",
              regel: "WCAG 2.2 2.4.4",
              melding: `De linktekst "${label}" zegt niet waar de link heen gaat.`,
              plek: plek(`Link "${label}"`),
              voorstel: { beschrijving: "Noem het doel in de linktekst, bijvoorbeeld de titel van de pagina.", vraag: { label: "Nieuwe linktekst", veld: "tekst" } },
            });
          }
        }
      }

      // Een onderstreepte link is gewoon een link (LibreOffice en Word zetten
      // de onderstreping van een link soms als <u> om de <a>).
      const alleenLink = (n: Element): boolean => {
        const k = elementKinderen(n);
        return k.length === 1 && (k[0].tagName === "a" || alleenLink(k[0])) && tekst(k[0]).trim() === tekst(n).trim();
      };
      if (tag === "u" && !alleenLink(e)) {
        nieuw({
          ernst: "advies",
          regel: "WCAG 2.2 1.3.1",
          melding: "Onderstreepte tekst lijkt op een link. Gebruik vet of cursief voor nadruk.",
          plek: plek(`Onderstreping "${kort(t)}"`),
        });
      }

      if (tag === "table") {
        const rijen: Element[] = [];
        const verzamel = (n: ParentNode) =>
          elementKinderen(n).forEach((k) => (k.tagName === "tr" ? rijen.push(k) : ["thead", "tbody", "tfoot"].includes(k.tagName) && verzamel(k)));
        verzamel(e);
        const heeftKop = rijen.some((r) => elementKinderen(r).some((c) => c.tagName === "th"));
        // In een rekenblad is een bereik cellen geen tabel met een kopregel
        // die de adapter kan zetten; daar alleen in tekst en dia's.
        if (!heeftKop && rijen.length > 1 && !beschrijvingOuder.includes(" · Blad ")) {
          nieuw({
            ernst: "fout",
            regel: "WCAG 2.2 1.3.1",
            melding: "Deze tabel heeft geen kopcellen. Een schermlezer kan cellen dan niet aan hun kolom koppelen.",
            plek: plek("Tabel"),
            voorstel: { beschrijving: "Maak van de eerste rij de kopregel.", vervanging: tabelMetKopregel(e) },
          });
        }
      }

      loop(e, p, beschrijvingOuder);
    });
  };

  loop(wortel, "body", "");

  // Presentatie: elke dia een titel, en verschillende titels.
  const gezien = new Map<string, number>();
  dias.forEach((d, i) => {
    if (!d.titel) {
      nieuw({
        ernst: "fout",
        regel: "WCAG 2.2 2.4.2",
        melding: `Dia ${i + 1} heeft geen titel. Met titels vindt een schermlezer zijn weg door de presentatie, en ze vormen de inhoudsopgave.`,
        plek: { pad: d.kopPad ?? d.pad, beschrijving: `Dia ${i + 1}` },
        voorstel: { beschrijving: "Geef de dia een titel die zegt waar zij over gaat.", vraag: { label: "Titel van de dia", veld: "titel" } },
      });
      return;
    }
    const sleutel = d.titel.toLowerCase();
    if (gezien.has(sleutel)) {
      nieuw({
        ernst: "advies",
        regel: "WCAG 2.2 2.4.6",
        melding: `Dia ${i + 1} heeft dezelfde titel als dia ${gezien.get(sleutel)! + 1} ("${kort(d.titel)}"). Verschillende titels maken het verschil hoorbaar.`,
        plek: { pad: d.kopPad ?? d.pad, beschrijving: `Dia ${i + 1}` },
        voorstel: { beschrijving: "Maak de titel onderscheidend, bijvoorbeeld met (vervolg) of een eigen onderwerp.", vraag: { label: "Titel van de dia", veld: "tekst" } },
      });
    } else gezien.set(sleutel, i);
  });

  // Rekenblad: bladen met een naam die zegt wat erin staat.
  bladen.forEach((b) => {
    if (STANDAARD_BLADNAAM.test(b.titel)) {
      nieuw({
        ernst: "advies",
        regel: "WCAG 2.2 2.4.6",
        melding: `Het blad "${b.titel}" heeft de standaardnaam. Een naam die zegt wat erin staat, helpt bij het navigeren.`,
        plek: { pad: b.kopPad ?? b.pad, beschrijving: `Blad "${b.titel}"` },
        voorstel: { beschrijving: "Geef het blad een naam, bijvoorbeeld Begroting 2027.", vraag: { label: "Naam van het blad", veld: "tekst" } },
      });
    }
  });
  if (dias.length > 0 || bladen.length > 0) return bevindingen;

  // Kopstructuur (tekstdocumenten)
  if (koppen.length === 0 && alineas >= 5) {
    nieuw({
      ernst: "advies",
      regel: "WCAG 2.2 2.4.6",
      melding: "Dit document heeft geen koppen. Koppen maken een lang stuk overzichtelijk en navigeerbaar.",
      voorstel: { beschrijving: "Gebruik de kopstijlen van de tekstverwerker voor de titel en de paragrafen." },
    });
  }
  let vorige = 0;
  koppen.forEach((k, i) => {
    if (i === 0 && k.niveau !== 1) {
      nieuw({
        ernst: "waarschuwing",
        regel: "WCAG 2.2 1.3.1",
        melding: `Het document begint met een kop van niveau ${k.niveau}. De titel hoort kop 1 te zijn.`,
        plek: k.plek,
        voorstel: { beschrijving: "Maak hier kop 1 van.", vervanging: metTag(k.e, "h1") },
      });
    } else if (i > 0 && k.niveau > vorige + 1) {
      const goed = vorige + 1;
      nieuw({
        ernst: "waarschuwing",
        regel: "WCAG 2.2 1.3.1",
        melding: `Na kop ${vorige} volgt kop ${k.niveau}; er wordt een niveau overgeslagen.`,
        plek: k.plek,
        voorstel: { beschrijving: `Maak hier kop ${goed} van.`, vervanging: metTag(k.e, `h${goed}`) },
      });
    }
    vorige = i === 0 ? 1 : Math.min(k.niveau, vorige + 1);
  });
  if (koppen.filter((k) => k.niveau === 1).length > 1) {
    const tweede = koppen.filter((k) => k.niveau === 1)[1];
    nieuw({
      ernst: "advies",
      regel: "WCAG 2.2 1.3.1",
      melding: "Er is meer dan één kop 1. Gebruik kop 1 alleen voor de titel.",
      plek: tweede.plek,
      voorstel: { beschrijving: "Maak hier kop 2 van.", vervanging: metTag(tweede.e, "h2") },
    });
  }

  return bevindingen;
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Dezelfde tabel, met de cellen van de eerste rij als kopcellen in een thead. */
function tabelMetKopregel(tabel: Element): string {
  const html = serializeOuter(tabel);
  const t = parseFragment(html);
  const nieuw = elementKinderen(t)[0];
  const rijen: { rij: Element; ouder: ParentNode }[] = [];
  const verzamel = (n: ParentNode) =>
    elementKinderen(n).forEach((k) => (k.tagName === "tr" ? rijen.push({ rij: k, ouder: n }) : ["thead", "tbody", "tfoot"].includes(k.tagName) && verzamel(k)));
  verzamel(nieuw);
  const eerste = rijen[0];
  for (const c of elementKinderen(eerste.rij)) {
    if (c.tagName === "td") {
      c.tagName = "th";
      c.nodeName = "th";
      c.attrs = [...c.attrs.filter((a) => a.name !== "scope"), { name: "scope", value: "col" }];
    }
  }
  // Rij naar een thead aan het begin van de tabel verplaatsen.
  eerste.ouder.childNodes = eerste.ouder.childNodes.filter((k) => k !== eerste.rij);
  const thead: Element = {
    nodeName: "thead",
    tagName: "thead",
    attrs: [],
    namespaceURI: nieuw.namespaceURI,
    childNodes: [eerste.rij],
    parentNode: nieuw,
  } as Element;
  eerste.rij.parentNode = thead;
  nieuw.childNodes = [thead, ...nieuw.childNodes];
  return serializeOuter(nieuw);
}
