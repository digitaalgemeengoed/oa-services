// De controle van het bestand (oa-wcag): doorsturen, omzetten en samenvoegen.
// oa-wcag is hier nagebootst; met WCAG_TEST_URL en WCAG_TEST_SLEUTEL draait er ook een test tegen de echte dienst.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { oaWcag, voegSamen, regelNaar22 } from "../dist/wcag.js";
import { bouwServer } from "../dist/server.js";

const SLEUTEL = "diensten-sleutel-0123456789";
const docx = (data = "UEsDBAo=") => ({ formaat: "docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", codering: "base64", data });
const html = (data) => ({ formaat: "html", mediaType: "text/html", codering: "tekst", data });

/** Nagebootste oa-wcag: controleert sleutel en formaat, en geeft vaste bevindingen. */
async function nepWcag(antwoord) {
  const gezien = [];
  const server = http.createServer((req, res) => {
    const delen = [];
    req.on("data", (d) => delen.push(d));
    req.on("end", () => {
      gezien.push({ url: req.url, sleutel: req.headers["x-oa-dienstsleutel"], bytes: Buffer.concat(delen) });
      res.writeHead(antwoord.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(antwoord.lichaam));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { adres: `http://127.0.0.1:${server.address().port}`, gezien, stop: () => server.close() };
}

const WCAG_ANTWOORD = {
  formaat: "docx",
  gecontroleerd: ["WCAG 2.1 1.1.1 Niet-tekstuele content", "WCAG 2.1 3.1.1 Taal van de pagina"],
  bevindingen: [
    { id: "wcag-1", ernst: "fout", regel: "WCAG 2.1 3.1.1", melding: "De documenttaal is niet ingesteld.", plek: { beschrijving: "Het document (eigenschappen)" } },
    { id: "wcag-2", ernst: "fout", regel: "WCAG 2.1 1.1.1", melding: "Afbeelding mist een alternatieve tekst.", plek: { beschrijving: "Afbeelding (Image1)" } },
    { id: "wcag-3", ernst: "waarschuwing", regel: "WCAG 2.1 1.4.3", melding: "Onvoldoende kleurcontrast.", voorstel: { beschrijving: "Donkerder." }, plek: { beschrijving: "Alinea \"Let op\"", fragment: "Let op" } },
  ],
};

test("regels heten WCAG 2.2, behalve het vervallen 4.1.1", () => {
  assert.equal(regelNaar22("WCAG 2.1 1.4.3"), "WCAG 2.2 1.4.3");
  assert.match(regelNaar22("WCAG 2.1 4.1.1"), /vervallen/);
});

test("stuurt het bestand als bytes met de sleutel, en zet het antwoord om", async () => {
  const nep = await nepWcag({ lichaam: WCAG_ANTWOORD });
  try {
    const r = await oaWcag(nep.adres, "wcag-sleutel")(docx(Buffer.from("PKinhoud").toString("base64")));
    assert.equal(nep.gezien[0].url, "/controle?formaat=docx");
    assert.equal(nep.gezien[0].sleutel, "wcag-sleutel");
    assert.equal(nep.gezien[0].bytes.toString(), "PKinhoud");
    assert.equal(r.bevindingen.length, 3);
    const contrast = r.bevindingen[2];
    assert.equal(contrast.regel, "WCAG 2.2 1.4.3");
    assert.equal(contrast.bron, "bestand");
    assert.deepEqual(contrast.plek, { pad: "", beschrijving: 'Alinea "Let op"', fragment: "Let op" });
    assert.equal(contrast.voorstel.beschrijving, "Donkerder.");
  } finally {
    nep.stop();
  }
});

test("odt, een storing of een fout van de dienst: een advies, geen fout", async () => {
  const odt = await oaWcag("http://127.0.0.1:9", "x")({ ...docx(), formaat: "odt" });
  assert.equal(odt.bevindingen[0].ernst, "advies");
  assert.match(odt.bevindingen[0].melding, /odt/);
  const weg = await oaWcag("http://127.0.0.1:9", "x")(docx());
  assert.match(weg.bevindingen[0].melding, /niet bereikbaar/);
  const nep = await nepWcag({ status: 422, lichaam: { fout: "onleesbaar", melding: "Dit bestand kon niet worden gelezen." } });
  try {
    const kapot = await oaWcag(nep.adres, "x")(docx());
    assert.match(kapot.bevindingen[0].melding, /kon niet worden gelezen/);
  } finally {
    nep.stop();
  }
});

test("samenvoegen: wat de html al vond telt niet dubbel; titel en taal blijven", () => {
  const vanHtml = {
    gecontroleerd: ["WCAG 2.2 1.1.1 Niet-tekstuele content", "WCAG 2.2 2.4.6 Koppen en labels"],
    bevindingen: [{ id: "tg-1", module: "toegankelijkheid", ernst: "fout", regel: "WCAG 2.2 1.1.1", melding: "Deze afbeelding heeft geen alternatieve tekst.", plek: { pad: "body/2", beschrijving: "Afbeelding" } }],
  };
  const vanBestand = {
    gecontroleerd: ["WCAG 2.2 1.1.1 Niet-tekstuele content", "WCAG 2.2 3.1.1 Taal van de pagina"],
    bevindingen: [
      { id: "wcag-1", module: "toegankelijkheid", ernst: "fout", regel: "WCAG 2.2 3.1.1", melding: "Taal", plek: { pad: "", beschrijving: "Het document (eigenschappen)" }, bron: "bestand" },
      { id: "wcag-2", module: "toegankelijkheid", ernst: "fout", regel: "WCAG 2.2 1.1.1", melding: "Afbeelding", plek: { pad: "", beschrijving: "Afbeelding (Image1)" }, bron: "bestand" },
    ],
  };
  const r = voegSamen(vanHtml, vanBestand);
  assert.deepEqual(r.bevindingen.map((b) => `${b.id}:${b.bron}`), ["tg-1:inhoud", "wcag-1:bestand"]);
  assert.deepEqual(r.gecontroleerd, ["WCAG 2.2 1.1.1 Niet-tekstuele content", "WCAG 2.2 2.4.6 Koppen en labels", "WCAG 2.2 3.1.1 Taal van de pagina"]);
  // Vindt het bestand méér afbeeldingen zonder alt-tekst dan de html, dan blijven ze.
  const meer = voegSamen(vanHtml, { ...vanBestand, bevindingen: [...vanBestand.bevindingen, { ...vanBestand.bevindingen[1], id: "wcag-3" }] });
  assert.equal(meer.bevindingen.filter((b) => b.bron === "bestand" && b.regel === "WCAG 2.2 1.1.1").length, 2);
});

test("de route: met bestand samengevoegd, zonder bestand zoals voorheen", async () => {
  const nep = await nepWcag({ lichaam: WCAG_ANTWOORD });
  const app = bouwServer({ dienstsleutel: SLEUTEL, log: false, anonimiseer: null, bestandsControle: oaWcag(nep.adres, "wcag-sleutel") });
  try {
    const vraag = (body) => app.inject({ method: "POST", url: "/toegankelijkheid", headers: { "x-oa-dienstsleutel": SLEUTEL }, payload: body });
    const zonder = (await vraag({ inhoud: html("<h1>Titel</h1><p>Tekst</p>") })).json();
    assert.ok(zonder.bevindingen.every((b) => b.bron !== "bestand"));
    assert.equal(nep.gezien.length, 0);
    const met = (await vraag({ inhoud: html("<h1>Titel</h1><p>Tekst</p>"), bestand: docx() })).json();
    assert.equal(nep.gezien.length, 1);
    assert.ok(met.bevindingen.some((b) => b.bron === "bestand" && b.regel === "WCAG 2.2 3.1.1"));
    assert.ok(met.gecontroleerd.some((g) => g.startsWith("WCAG 2.2 3.1.1")));
  } finally {
    await app.close();
    nep.stop();
  }
});

test("tegen de echte oa-wcag (alleen met WCAG_TEST_URL)", { skip: !process.env.WCAG_TEST_URL }, async () => {
  const { readFileSync } = await import("node:fs");
  const bestand = readFileSync(process.env.WCAG_TEST_BESTAND);
  const r = await oaWcag(process.env.WCAG_TEST_URL, process.env.WCAG_TEST_SLEUTEL)(docx(bestand.toString("base64")));
  assert.ok(r.bevindingen.length > 0);
  assert.ok(r.bevindingen.every((b) => b.bron === "bestand" && b.regel && b.melding));
  assert.ok(r.gecontroleerd.length > 10);
  console.log(r.bevindingen.map((b) => `${b.ernst} ${b.regel} ${b.melding} · ${b.plek?.beschrijving ?? ""}`).join("\n"));
});
