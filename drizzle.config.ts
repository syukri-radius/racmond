import "dotenv/config";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit 1.0 loads this as ESM — it must be a .ts file (a JSON config is
 * rejected: "needs an import attribute").
 *
 * SQLite dialect accepts only `{ url }` for dbCredentials: no `driver` field for
 * a plain file, and no authToken key (the runtime app reads the token envs).
 */
function resolveUrl(): string {
  const candidates = [
    process.env.LIBSQL_URL,
    process.env.TURSO_DATABASE_URL,
    process.env.DATABASE_URL,
    process.env.SQLITE_URL,
  ];
  for (const value of candidates) {
    if (!value || !value.trim()) continue;
    if (/^postgres(ql)?:\/\//i.test(value)) continue;
    if (!/^(file|libsql|https?|wss?):\/\//i.test(value)) continue;
    return value.trim();
  }
  return `file:${path.join(process.cwd(), "data", "dockflow.db")}`;
}

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: resolveUrl() },
});
