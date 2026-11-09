import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

/** De eigen versie, voor /gezondheid (de overzichtspagina toont welke versie draait). */
const VERSIE = (() => {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "onbekend";
  } catch {
    return "onbekend";
  }
})();
import {
  INHOUD_SCHEMA,
  type AnonimiseerAntwoord,
  type AnonimiseerVraag,
  type ToegankelijkheidAntwoord,
  type ToegankelijkheidVraag,
  type ToepassenAntwoord,
  type ToepassenVraag,
} from "@digitaalgemeengoed/oa-contract";
import { beoordeelHtml, GECONTROLEERD } from "./toegankelijkheid.js";
import { analyseer, LABEL, MotorNietBeschikbaar, pasToe, type Motor } from "./anonimiseren.js";

/**
 * Assistent-services achter de lezende ingang. Lezen en rekenen, nooit
 * vastleggen: deze dienst heeft geen database en geen opslag.
 */
export function bouwServer(opties: { dienstsleutel: string; log?: boolean; anonimiseer?: Motor | null }): FastifyInstance {
  const app = Fastify({ logger: opties.log ?? true, bodyLimit: 30 * 1024 * 1024 });
  const sleutel = Buffer.from(opties.dienstsleutel);

  app.addHook("onRequest", async (req, antwoord) => {
    if (req.url === "/gezondheid") return;
    const gegeven = Buffer.from(String(req.headers["x-oa-dienstsleutel"] ?? ""));
    if (gegeven.length !== sleutel.length || !timingSafeEqual(gegeven, sleutel)) {
      return antwoord.status(401).send({ fout: "geen-toegang", melding: "Alleen de integratielaag mag deze dienst aanroepen." });
    }
  });

  app.get("/gezondheid", async () => ({ status: "ok", versie: VERSIE }));

  app.post<{ Body: ToegankelijkheidVraag }>(
    "/toegankelijkheid",
    { schema: { body: { type: "object", required: ["inhoud"], properties: { inhoud: INHOUD_SCHEMA, taal: { type: "string" } } } } },
    async (req): Promise<ToegankelijkheidAntwoord> => {
      const { inhoud } = req.body;
      if (inhoud.formaat !== "html") {
        return {
          gecontroleerd: [],
          bevindingen: [
            {
              id: "tg-formaat",
              module: "toegankelijkheid",
              ernst: "advies",
              regel: "—",
              melding: `Toegankelijkheid beoordelen kan in dit prototype alleen voor html, nog niet voor ${inhoud.formaat}.`,
            },
          ],
        };
      }
      return { gecontroleerd: GECONTROLEERD, bevindingen: beoordeelHtml(inhoud.data) };
    },
  );

  const alleenHtml = (formaat: string) => ({
    fout: "formaat",
    melding: `Anonimiseren kan in dit prototype alleen voor html, nog niet voor ${formaat}.`,
  });

  app.post<{ Body: AnonimiseerVraag }>(
    "/anonimiseren",
    { schema: { body: { type: "object", required: ["inhoud"], properties: { inhoud: INHOUD_SCHEMA } } } },
    async (req, antwoord): Promise<AnonimiseerAntwoord | void> => {
      const { inhoud } = req.body;
      if (inhoud.formaat !== "html") return antwoord.status(422).send(alleenHtml(inhoud.formaat));
      if (!opties.anonimiseer) {
        return antwoord.status(503).send({ fout: "anonimiseren-uit", melding: "Anonimiseren is in deze omgeving niet ingesteld." });
      }
      try {
        return await analyseer(inhoud.data, opties.anonimiseer);
      } catch (e) {
        if (e instanceof MotorNietBeschikbaar) {
          req.log.warn({ fout: e.message }, "anonimiseren niet beschikbaar");
          return antwoord.status(503).send({ fout: "anonimiseren-niet-bereikbaar", melding: "De herkenning van persoonsgegevens is nu niet bereikbaar. Probeer het later opnieuw." });
        }
        throw e;
      }
    },
  );

  app.post<{ Body: ToepassenVraag }>(
    "/anonimiseren/toepassen",
    {
      schema: {
        body: {
          type: "object",
          required: ["inhoud", "treffers"],
          properties: {
            inhoud: INHOUD_SCHEMA,
            treffers: {
              type: "array",
              maxItems: 20000,
              items: {
                type: "object",
                required: ["begin", "eind", "soort"],
                properties: { begin: { type: "integer", minimum: 0 }, eind: { type: "integer", minimum: 0 }, soort: { enum: Object.keys(LABEL) } },
              },
            },
          },
        },
      },
    },
    async (req, antwoord): Promise<ToepassenAntwoord | void> => {
      const { inhoud, treffers } = req.body;
      if (inhoud.formaat !== "html") return antwoord.status(422).send(alleenHtml(inhoud.formaat));
      const r = pasToe(inhoud.data, treffers);
      return { inhoud: { formaat: "html", mediaType: "text/html", codering: "tekst", data: r.html }, overzicht: r.overzicht };
    },
  );

  return app;
}
