import type { Bevinding, Inhoud } from "@digitaalgemeengoed/oa-contract";

/**
 * De toegankelijkheidscontrole van het bestand zelf (oa-wcag, op dezelfde
 * server, alleen intern bereikbaar). Vult de controle van de html aan met
 * wat daarin niet te zien is: titel en taal, contrast, leesvolgorde,
 * alt-tekst van grafieken en groepen, samengevoegde cellen …
 */
export interface BestandsControle {
  (bestand: Inhoud): Promise<{ bevindingen: Bevinding[]; gecontroleerd: string[] }>;
}

const OOXML = new Set(["docx", "xlsx", "pptx"]);

interface WcagBevinding {
  id: string;
  ernst: Bevinding["ernst"];
  regel: string;
  melding: string;
  voorstel?: { beschrijving: string };
  plek?: { beschrijving: string; fragment?: string; waar?: { soort?: string } };
  controle?: string;
}

/** Een advies in plaats van een foutmelding: de controle van de html gaat gewoon door. */
function advies(melding: string): Bevinding {
  return { id: "wcag-niet", module: "toegankelijkheid", ernst: "advies", regel: "—", melding, bron: "bestand" };
}

/**
 * WCAG 2.2 bevat alle criteria van 2.1 op niveau AA, behalve 4.1.1 (vervallen).
 * Zo staan de bevindingen uit het bestand onder dezelfde naam als die uit de html.
 */
export function regelNaar22(regel: string): string {
  if (/^WCAG 2\.1 4\.1\.1\b/.test(regel)) return "WCAG 2.1 4.1.1 (vervallen in 2.2; advies)";
  return regel.replace(/^WCAG 2\.1 /, "WCAG 2.2 ");
}

export function oaWcag(adres: string, sleutel: string, tijdslimietMs = 40_000): BestandsControle {
  const basis = adres.replace(/\/$/, "");
  return async (bestand) => {
    if (!OOXML.has(bestand.formaat) || bestand.codering !== "base64") {
      return {
        bevindingen: [
          advies(
            `De uitgebreide controle van het bestand kan nog niet voor ${bestand.formaat}, alleen voor docx, xlsx en pptx. De controle van de inhoud is wel gedaan.`,
          ),
        ],
        gecontroleerd: [],
      };
    }
    let r: Response;
    try {
      r = await fetch(`${basis}/controle?formaat=${bestand.formaat}`, {
        method: "POST",
        headers: { "x-oa-dienstsleutel": sleutel, "content-type": "application/octet-stream" },
        body: Buffer.from(bestand.data, "base64"),
        signal: AbortSignal.timeout(tijdslimietMs),
      });
    } catch {
      return { bevindingen: [advies("De uitgebreide controle van het bestand is nu niet bereikbaar. De controle van de inhoud is wel gedaan.")], gecontroleerd: [] };
    }
    const j = (await r.json().catch(() => ({}))) as { bevindingen?: WcagBevinding[]; gecontroleerd?: string[]; melding?: string };
    if (!r.ok) {
      return {
        bevindingen: [advies(`De uitgebreide controle van het bestand lukte niet: ${j.melding ?? `fout ${r.status}`}. De controle van de inhoud is wel gedaan.`)],
        gecontroleerd: [],
      };
    }
    const bevindingen: Bevinding[] = (j.bevindingen ?? []).map((b) => ({
      id: b.id,
      module: "toegankelijkheid",
      ernst: b.ernst,
      regel: regelNaar22(b.regel),
      melding: b.melding,
      ...(b.voorstel ? { voorstel: { beschrijving: b.voorstel.beschrijving } } : {}),
      // Geen pad: het bestand is geen html. De beschrijving zegt waar; het fragment is om op te zoeken.
      ...(b.plek ? { plek: { pad: "", beschrijving: b.plek.beschrijving, ...(b.plek.fragment ? { fragment: b.plek.fragment } : {}) } } : {}),
      bron: "bestand",
    }));
    return { bevindingen, gecontroleerd: (j.gecontroleerd ?? []).map(regelNaar22) };
  };
}

/** Het nummer van het criterium: "WCAG 2.2 1.1.1 …" → "1.1.1". */
function criterium(regel: string): string | null {
  return /WCAG 2\.\d (\d+\.\d+\.\d+)/.exec(regel)?.[1] ?? null;
}

/**
 * Samenvoegen. Wat de html-controle al vond, kan de assistent zelf herstellen;
 * dezelfde soort bevinding uit het bestand telt dan niet nog eens. Dat geldt
 * per criterium dat beide controleren, als de html minstens zoveel vond als
 * het bestand. Bevindingen over het document als geheel (titel, taal) komen
 * alleen uit het bestand en blijven altijd.
 */
export function voegSamen(
  html: { bevindingen: Bevinding[]; gecontroleerd: string[] },
  bestand: { bevindingen: Bevinding[]; gecontroleerd: string[] },
): { bevindingen: Bevinding[]; gecontroleerd: string[] } {
  const telHtml = new Map<string, number>();
  for (const b of html.bevindingen) {
    const c = criterium(b.regel);
    if (c) telHtml.set(c, (telHtml.get(c) ?? 0) + 1);
  }
  const telBestand = new Map<string, number>();
  for (const b of bestand.bevindingen) {
    const c = criterium(b.regel);
    if (c && b.plek?.beschrijving !== "Het document (eigenschappen)") telBestand.set(c, (telBestand.get(c) ?? 0) + 1);
  }
  const dubbel = (b: Bevinding): boolean => {
    const c = criterium(b.regel);
    if (!c || b.plek?.beschrijving === "Het document (eigenschappen)") return false;
    return (telHtml.get(c) ?? 0) >= (telBestand.get(c) ?? 0);
  };
  const gezien = new Set<string>();
  const gecontroleerd: string[] = [];
  for (const g of [...html.gecontroleerd, ...bestand.gecontroleerd]) {
    const c = criterium(g) ?? g;
    if (!gezien.has(c)) {
      gezien.add(c);
      gecontroleerd.push(g);
    }
  }
  gecontroleerd.sort((a, b) => (criterium(a) ?? a).localeCompare(criterium(b) ?? b, "nl", { numeric: true }));
  return {
    bevindingen: [...html.bevindingen.map((b) => ({ ...b, bron: "inhoud" as const })), ...bestand.bevindingen.filter((b) => !dubbel(b))],
    gecontroleerd,
  };
}
