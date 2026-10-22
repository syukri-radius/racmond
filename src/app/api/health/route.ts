import { NextResponse } from "next/server";
import { ensureDb, databaseTarget, rawClient } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Async health probe: awaits the database bootstrap and reports the resolved
 * target (engine, file|remote, token presence, replica, size, table count).
 */
export async function GET() {
  const started = Date.now();
  try {
    await ensureDb();
    const client = rawClient();
    await client.execute("SELECT 1");
    let tables = 0;
    let sizeBytes: number | null = null;
    try {
      const result = await client.execute("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
      tables = Number(result.rows[0]?.count ?? 0);
      const pageCount = await client.execute("PRAGMA page_count");
      const pageSize = await client.execute("PRAGMA page_size");
      const count = Number(Object.values(pageCount.rows[0] ?? {})[0] ?? 0);
      const size = Number(Object.values(pageSize.rows[0] ?? {})[0] ?? 0);
      if (count && size) sizeBytes = count * size;
    } catch {
      /* remote targets may restrict pragmas */
    }
    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - started,
      database: {
        engine: databaseTarget.engine,
        kind: databaseTarget.kind,
        tokenPresent: databaseTarget.tokenPresent,
        replica: databaseTarget.replica,
        url: databaseTarget.url.replace(/authToken=[^&]+/, "authToken=***"),
        sizeBytes,
        tables,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
        database: { engine: databaseTarget.engine, kind: databaseTarget.kind },
      },
      { status: 503 },
    );
  }
}
