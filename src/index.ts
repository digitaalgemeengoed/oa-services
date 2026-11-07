import { bouwServer } from "./server.js";

const sleutel = process.env.DIENSTEN_DIENSTSLEUTEL;
if (!sleutel) throw new Error("Omgevingsvariabele DIENSTEN_DIENSTSLEUTEL ontbreekt");

const app = bouwServer({ dienstsleutel: sleutel });
await app.listen({ port: Number(process.env.POORT ?? 4200), host: process.env.HOST ?? "0.0.0.0" });
