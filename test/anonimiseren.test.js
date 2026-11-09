// Anonimiseren: tekst en blokken uit html, eigen patronen voor adressen,
// opschonen, en afschermen. De herkenning zelf is hier nagebootst; met
// OPENANONYMISER_TEST_URL draait er ook een test tegen een echte OpenAnonymiser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseer, lees, pasToe, openAnonymiser } from "../dist/anonimiseren.js";
import { bouwServer } from "../dist/server.js";

const HTML =
  '<h1>Besluit op bezwaar</h1><p>Geachte <strong>heer De</strong> Vries,</p><p>U woont op de Kruisweg 12, 2011 LB Haarlem. Uw BSN is 111222333.</p>' +
  "<p>Het college van Burgemeester van Reenensingel 5 tot Haarlem.</p>" +
  "<table><tbody><tr><td>Contact</td><td>Sanne de Boer, 06-12345678</td></tr></tbody></table>";

/** Nagebootste motor: vindt wat een echte zou vinden, met de bekende eigenaardigheden. */
const nep = {
  naam: "nep",
  async analyseer(tekst) {
    const uit = [];
    const zoek = (type, s, score = 0.85) => {
      let i = -1;
      while ((i = tekst.indexOf(s, i + 1)) >= 0) uit.push({ type, begin: i, eind: i + s.length, score });
    };
    zoek("PERSON", "heer De Vries");
    zoek("PERSON", "Sanne de Boer");
    zoek("BSN", "111222333", 1);
    zoek("PHONE_NUMBER", "06-12345678", 0.6);
    zoek("PERSON", "Vries,", 0.5); // overlapt met een langere naam
    zoek("KVK_NUMBER", "12345678", 0.45); // in het telefoonnummer
    return uit;
  },
};

test("tekst per blok, met plek", () => {
  const k = lees(HTML);
  assert.equal(k.tekst, "Besluit op bezwaar\n\nGeachte heer De Vries,\n\nU woont op de Kruisweg 12, 2011 LB Haarlem. Uw BSN is 111222333.\n\nHet college van Burgemeester van Reenensingel 5 tot Haarlem.\n\nContact\n\nSanne de Boer, 06-12345678");
  assert.deepEqual(k.blokken.map((b) => [b.plek.pad, b.plek.beschrijving]), [
    ["body/0", "Kop"],
    ["body/1", "Alinea 1"],
    ["body/2", "Alinea 2"],
    ["body/3", "Alinea 3"],
    ["body/4/0/0/0", "Cel"],
    ["body/4/0/0/1", "Cel"],
  ]);
});

test("treffers: aanhef eraf, adres erbij, overlap en witruimte weg", async () => {
  const a = await analyseer(HTML, nep);
  assert.deepEqual(
    a.treffers.map((t) => [t.soort, t.tekst, t.bron]),
    [
      ["naam", "De Vries", "model"],
      ["adres", "Kruisweg 12, 2011 LB Haarlem", "patroon"],
      ["bsn", "111222333", "model"],
      ["adres", "Burgemeester van Reenensingel 5", "patroon"],
      ["naam", "Sanne de Boer", "model"],
      ["telefoon", "06-12345678", "model"],
    ],
  );
  assert.equal(a.treffers[0].plek.pad, "body/1");
  assert.ok(a.standaard.includes("adres") && !a.standaard.includes("datum"));
});

test("afschermen: ook over opmaak heen; de opmaak blijft", async () => {
  const a = await analyseer(HTML, nep);
  const r = pasToe(HTML, a.treffers.filter((t) => t.tekst !== "Sanne de Boer" && t.soort !== "adres" || t.tekst.startsWith("Kruisweg")));
  assert.equal(
    r.html,
    '<h1>Besluit op bezwaar</h1><p>Geachte <strong>heer [naam]</strong>,</p><p>U woont op de [adres]. Uw BSN is [BSN].</p>' +
      "<p>Het college van Burgemeester van Reenensingel 5 tot Haarlem.</p><table><tbody><tr><td>Contact</td><td>Sanne de Boer, [telefoonnummer]</td></tr></tbody></table>",
  );
  assert.deepEqual(r.overzicht, { naam: 1, adres: 1, bsn: 1, telefoon: 1 });
});

test("de dienst: 503 zonder motor, 422 voor geen html, en heen en terug", async () => {
  const kop = { "x-oa-dienstsleutel": "test-sleutel-0123456789" };
  const zonder = bouwServer({ dienstsleutel: kop["x-oa-dienstsleutel"], log: false });
  const r0 = await zonder.inject({ method: "POST", url: "/anonimiseren", headers: kop, payload: { inhoud: { formaat: "html", mediaType: "text/html", codering: "tekst", data: HTML } } });
  assert.equal(r0.statusCode, 503);
  const app = bouwServer({ dienstsleutel: kop["x-oa-dienstsleutel"], log: false, anonimiseer: nep });
  const r1 = await app.inject({ method: "POST", url: "/anonimiseren", headers: kop, payload: { inhoud: { formaat: "docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", codering: "base64", data: "UEsDBA==" } } });
  assert.equal(r1.statusCode, 422);
  const r2 = await app.inject({ method: "POST", url: "/anonimiseren", headers: kop, payload: { inhoud: { formaat: "html", mediaType: "text/html", codering: "tekst", data: HTML } } });
  const { treffers } = r2.json();
  const r3 = await app.inject({
    method: "POST",
    url: "/anonimiseren/toepassen",
    headers: kop,
    payload: { inhoud: { formaat: "html", mediaType: "text/html", codering: "tekst", data: HTML }, treffers: treffers.map(({ begin, eind, soort }) => ({ begin, eind, soort })) },
  });
  assert.equal(r3.statusCode, 200, r3.body);
  assert.doesNotMatch(r3.json().inhoud.data, /Vries|111222333|Kruisweg|Sanne/);
  const onbekend = bouwServer({ dienstsleutel: kop["x-oa-dienstsleutel"], log: false, anonimiseer: openAnonymiser("http://127.0.0.1:9", 500) });
  const r4 = await onbekend.inject({ method: "POST", url: "/anonimiseren", headers: kop, payload: { inhoud: { formaat: "html", mediaType: "text/html", codering: "tekst", data: HTML } } });
  assert.equal(r4.statusCode, 503);
  assert.equal(r4.json().fout, "anonimiseren-niet-bereikbaar");
});

test("tegen een echte OpenAnonymiser", { skip: !process.env.OPENANONYMISER_TEST_URL && "zet OPENANONYMISER_TEST_URL" }, async () => {
  const a = await analyseer(HTML, openAnonymiser(process.env.OPENANONYMISER_TEST_URL));
  const gevonden = a.treffers.map((t) => `${t.soort}:${t.tekst}`);
  for (const v of ["naam:De Vries", "naam:Sanne de Boer", "bsn:111222333", "adres:Kruisweg 12, 2011 LB Haarlem", "telefoon:06-12345678"]) assert.ok(gevonden.includes(v), `${v} niet in ${gevonden}`);
  assert.ok(!gevonden.some((g) => g.startsWith("kvk-nummer")), String(gevonden));
});
