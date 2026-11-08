import { test } from "node:test";
import assert from "node:assert/strict";
import { beoordeelHtml } from "../dist/toegankelijkheid.js";
import { bouwServer } from "../dist/server.js";

const regels = (html) => beoordeelHtml(html).map((b) => `${b.regel}|${b.plek?.pad ?? "-"}`);

test("afbeelding zonder alt is een fout met een vraag om tekst", () => {
  const b = beoordeelHtml('<h1>T</h1><p><img src="kaart.png"></p>');
  assert.equal(b.length, 1);
  assert.equal(b[0].ernst, "fout");
  assert.equal(b[0].plek.pad, "body/1/0");
  assert.equal(b[0].voorstel.vraag.veld, "alt");
});

test("een lege alt (versiering) is in orde", () => {
  assert.deepEqual(beoordeelHtml('<h1>T</h1><img src="lijn.png" alt="">'), []);
});

test("overgeslagen kopniveau krijgt een vervanging met het juiste niveau", () => {
  const b = beoordeelHtml("<h1>Titel</h1><h3 class='x'>Sub</h3>");
  assert.equal(b.length, 1);
  assert.equal(b[0].voorstel.vervanging, '<h2 class="x">Sub</h2>');
});

test("eerste kop moet kop 1 zijn", () => {
  const b = beoordeelHtml("<h2>Titel</h2><p>x</p>");
  assert.equal(b[0].voorstel.vervanging, "<h1>Titel</h1>");
});

test("vette alinea als kop wordt gesignaleerd", () => {
  const b = beoordeelHtml("<h1>T</h1><p><strong>Financiën</strong></p>");
  assert.equal(b[0].voorstel.vervanging, "<h2>Financiën</h2>");
});

test("vage linktekst en lege link", () => {
  assert.deepEqual(regels('<h1>T</h1><p>Zie <a href="/x">hier</a> en <a href="/y"></a></p>'), [
    "WCAG 2.2 2.4.4|body/1/0",
    "WCAG 2.2 2.4.4|body/1/1",
  ]);
});

test("tabel zonder kopcellen krijgt een kopregel", () => {
  const b = beoordeelHtml("<h1>T</h1><table><tr><td>Jaar</td><td>Bedrag</td></tr><tr><td>2026</td><td>10</td></tr></table>");
  assert.equal(b.length, 1);
  assert.match(b[0].voorstel.vervanging, /^<table><thead><tr><th scope="col">Jaar<\/th><th scope="col">Bedrag<\/th><\/tr><\/thead><tbody><tr><td>2026<\/td>/);
});

test("lang stuk zonder koppen krijgt advies", () => {
  const b = beoordeelHtml("<p>a</p>".repeat(6));
  assert.equal(b.length, 1);
  assert.equal(b[0].ernst, "advies");
});

test("de dienst weigert aanroepen zonder dienstsleutel en beoordeelt html", async () => {
  const app = bouwServer({ dienstsleutel: "s3cret-s3cret", log: false });
  const zonder = await app.inject({ method: "POST", url: "/toegankelijkheid", payload: {} });
  assert.equal(zonder.statusCode, 401);
  const met = await app.inject({
    method: "POST",
    url: "/toegankelijkheid",
    headers: { "x-oa-dienstsleutel": "s3cret-s3cret" },
    payload: { inhoud: { formaat: "html", mediaType: "text/html", codering: "tekst", data: "<h1>T</h1><img src='a.png'>" } },
  });
  assert.equal(met.statusCode, 200);
  assert.equal(met.json().bevindingen.length, 1);
  await app.close();
});

test("een onderstreepte link is geen nep-link", async () => {
  const { beoordeelHtml } = await import("../dist/toegankelijkheid.js");
  const b = beoordeelHtml('<p>Zie <u><a href="https://x.nl">de begroting 2027</a></u>.</p><p><u>Echt onderstreept</u></p>');
  assert.equal(b.filter((x) => x.melding.startsWith("Onderstreepte tekst")).length, 1);
});
