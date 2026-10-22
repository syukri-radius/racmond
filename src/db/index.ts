import { mkdirSync } from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { envFirst, envOrNull, isBlank } from "@/lib/env";
import * as schema from "./schema";
import { DDL, splitStatements } from "./bootstrap";

/**
 * Single SQLite driver for the whole app: @libsql/client (async only).
 *
 * URL resolution order: LIBSQL_URL, TURSO_DATABASE_URL, DATABASE_URL, then a
 * file database under ./data. Blank values are treated as unset, postgres://
 * URLs from other templates are ignored, and file:/libsql:/http(s):/ws(s): are
 * accepted. Turso embedded replicas are supported through LIBSQL_SYNC_URL.
 */

const SCHEME = /^(file|libsql|https?|wss?):\/\//i;

function isPostgresUrl(value: string): boolean {
  return /^postgres(ql)?:\/\//i.test(value) || value.startsWith("postgresql://");
}

export function resolveDatabaseUrl(): { url: string; remote: boolean } {
  const explicit = envFirst(
    ["LIBSQL_URL", "TURSO_DATABASE_URL", "DATABASE_URL", "SQLITE_URL"],
    "",
  );

  if (explicit && !isPostgresUrl(explicit) && SCHEME.test(explicit)) {
    return { url: explicit, remote: /^(https?|wss?|libsql):\/\//i.test(explicit) };
  }
  // relative sqlite path from a template, e.g. ./data/app.db
  if (explicit && !isPostgresUrl(explicit) && explicit.endsWith(".db")) {
    return { url: `file:${path.isAbsolute(explicit) ? explicit : path.join(process.cwd(), explicit)}`, remote: false };
  }

  return { url: `file:${path.join(process.cwd(), "data", "dockflow.db")}`, remote: false };
}

function ensureDirectoryForFile(url: string): void {
  if (!url.startsWith("file:")) return;
  const target = url.slice("file:".length);
  if (target === ":memory:") return;
  mkdirSync(path.dirname(target), { recursive: true });
}

const resolved = resolveDatabaseUrl();
ensureDirectoryForFile(resolved.url);

const syncUrl = envOrNull("LIBSQL_SYNC_URL") ?? envOrNull("TURSO_SYNC_URL");
const authToken = envOrNull("LIBSQL_AUTH_TOKEN") ?? envOrNull("TURSO_AUTH_TOKEN");

const client: Client = createClient({
  url: resolved.url,
  ...(resolved.url.startsWith("file:") && syncUrl && !isBlank(syncUrl)
    ? { syncUrl, authToken: authToken ?? undefined, syncInterval: 60 }
    : authToken
      ? { authToken }
      : {}),
});

export const db = drizzle({ client });
export const databaseTarget = {
  url: resolved.url,
  remote: resolved.remote,
  replica: Boolean(syncUrl) && resolved.url.startsWith("file:"),
  tokenPresent: Boolean(authToken),
  engine: "libsql",
  kind: resolved.url.startsWith("file:") ? ("file" as const) : ("remote" as const),
};

export function rawClient(): Client {
  return client;
}

/* ------------------------------------------------------------- bootstrap */

async function runDdl(): Promise<void> {
  const anyClient = client as unknown as { executeMultiple?: (sql: string) => Promise<unknown> };
  if (typeof anyClient.executeMultiple === "function") {
    await anyClient.executeMultiple(DDL);
    return;
  }
  for (const statement of splitStatements(DDL)) {
    await client.execute(statement);
  }
}

export async function bootstrapDatabase(): Promise<void> {
  // pragmas are best-effort: remote targets reject them
  for (const pragma of ["PRAGMA journal_mode = WAL", "PRAGMA busy_timeout = 5000", "PRAGMA foreign_keys = ON"]) {
    try {
      await client.execute(pragma);
    } catch {
      /* remote / readonly target */
    }
  }
  await runDdl();
  await client.execute("SELECT 1");
}

const globalForDb = globalThis as typeof globalThis & {
  __dockflowEnsureDb?: Promise<void>;
};

/**
 * Memoised async bootstrap. A failure clears the memo so the next call retries;
 * every API route awaits this through guard().
 */
export function ensureDb(): Promise<void> {
  if (!globalForDb.__dockflowEnsureDb) {
    globalForDb.__dockflowEnsureDb = bootstrapDatabase().catch((error) => {
      globalForDb.__dockflowEnsureDb = undefined;
      throw error;
    });
  }
  return globalForDb.__dockflowEnsureDb;
}

// kicked off at module load; failures surface through the routes that await it
if (typeof window === "undefined") {
  void ensureDb().catch((error) => {
    console.error("[db] bootstrap failed", error);
  });
}
