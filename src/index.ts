import { bouwServer } from "./server.js";
import { openAnonymiser } from "./anonimiseren.js";

const sleutel = process.env.DIENSTEN_DIENSTSLEUTEL;
if (!sleutel) throw new Error("Omgevingsvariabele DIENSTEN_DIENSTSLEUTEL ontbreekt");

// OpenAnonymiser (Conduction), alleen intern bereikbaar. Zonder adres staat anonimiseren uit.
const anonimiseer = process.env.OPENANONYMISER_URL ? openAnonymiser(process.env.OPENANONYMISER_URL) : null;
const app = bouwServer({ dienstsleutel: sleutel, anonimiseer });
await app.listen({ port: Number(process.env.POORT ?? 4200), host: process.env.HOST ?? "0.0.0.0" });
