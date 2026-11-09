import { bouwServer } from "./server.js";
import { openAnonymiser } from "./anonimiseren.js";
import { oaWcag } from "./wcag.js";

const sleutel = process.env.DIENSTEN_DIENSTSLEUTEL;
if (!sleutel) throw new Error("Omgevingsvariabele DIENSTEN_DIENSTSLEUTEL ontbreekt");

// OpenAnonymiser (Conduction), alleen intern bereikbaar. Zonder adres staat anonimiseren uit.
const anonimiseer = process.env.OPENANONYMISER_URL ? openAnonymiser(process.env.OPENANONYMISER_URL) : null;
// oa-wcag: de toegankelijkheidscontrole van het bestand zelf, alleen intern bereikbaar. Zonder adres alleen de html.
const bestandsControle = process.env.WCAG_URL ? oaWcag(process.env.WCAG_URL, process.env.WCAG_DIENSTSLEUTEL ?? "") : null;
const app = bouwServer({ dienstsleutel: sleutel, anonimiseer, bestandsControle });
await app.listen({ port: Number(process.env.POORT ?? 4200), host: process.env.HOST ?? "0.0.0.0" });
