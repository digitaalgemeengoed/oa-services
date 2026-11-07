import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { INHOUD_SCHEMA, type ToegankelijkheidAntwoord, type ToegankelijkheidVraag } from "@oa/contract";
import { beoordeelHtml, GECONTROLEERD } from "./toegankelijkheid.js";

/**
 * Assistent-services achter de lezende ingang. Lezen en rekenen, nooit
 * vastleggen: deze dienst heeft geen database en geen opslag.
 */
export function bouwServer(opties: { dienstsleutel: string; log?: boolean }): FastifyInstance {
  const app = Fastify({ logger: opties.log ?? true, bodyLimit: 30 * 1024 * 1024 });
  const sleutel = Buffer.from(opties.dienstsleutel);

  app.addHook("onRequest", async (req, antwoord) => {
    if (req.url === "/gezondheid") return;
    const gegeven = Buffer.from(String(req.headers["x-oa-dienstsleutel"] ?? ""));
    if (gegeven.length !== sleutel.length || !timingSafeEqual(gegeven, sleutel)) {
      return antwoord.status(401).send({ fout: "geen-toegang", melding: "Alleen de integratielaag mag deze dienst aanroepen." });
    }
  });

  app.get("/gezondheid", async () => ({ status: "ok" }));

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

  return app;
}
