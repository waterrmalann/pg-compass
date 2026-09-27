// Starts a seeded PGlite server and writes a PG Compass store directory with
// three connections to it. See ./README.md for the full capture workflow.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = 54330;
const storeDir = path.join(import.meta.dirname, ".store");
const seedSql = fs.readFileSync(path.join(import.meta.dirname, "seed.sql"), "utf8");

const db = await PGlite.create({ extensions: { vector } });
await db.exec(seedSql);
const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port, maxConnections: 20 });
await server.start();

function connection(label, color, favourite) {
  return {
    id: randomUUID(),
    label,
    favourite,
    mode: "fields",
    color,
    fields: { host: "127.0.0.1", port, database: "postgres", user: "postgres", password: "postgres" },
  };
}

fs.rmSync(storeDir, { recursive: true, force: true });
fs.mkdirSync(storeDir, { recursive: true });
fs.writeFileSync(
  path.join(storeDir, "connections.json"),
  JSON.stringify({
    connections: [
      connection("Production", "#3b82f6", true),
      connection("Staging", "#f59e0b", false),
      connection("Local", null, false),
    ],
  }),
);
fs.writeFileSync(
  path.join(storeDir, "settings.json"),
  JSON.stringify({
    settings: {
      general: { readOnlyMode: false, shellAccess: false, enableDevTools: true, hideInternalSchemas: true },
      appearance: { theme: "dark", sidebarWidth: 248, density: "compact" },
      privacy: { automaticUpdates: false },
    },
  }),
);
console.log(`READY port=${port} store=${storeDir}`);
