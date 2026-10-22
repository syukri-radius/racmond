import { db } from "@/db";
import { cliTools } from "@/db/schema";
import { eq } from "drizzle-orm";
import { guard, readJson } from "@/lib/api";
import { tokenizeArgs, runCommand } from "@/lib/cli";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return guard(async () => {
    const body = await readJson<{
      toolId?: string;
      binary?: string;
      args?: string | string[];
      cwd?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
    }>(request);

    let binary = body.binary ?? "";
    let args = Array.isArray(body.args) ? body.args : tokenizeArgs(body.args ?? "");
    let cwd = body.cwd;
    let env = body.env ?? {};

    if (body.toolId) {
      const [tool] = await db.select().from(cliTools).where(eq(cliTools.id, body.toolId));
      if (!tool) throw new Error("saved tool not found");
      binary = tool.binary;
      args = [...tokenizeArgs(tool.baseArgs), ...args];
      cwd = cwd ?? tool.cwd ?? undefined;
      env = { ...(tool.env ?? {}), ...env };
    }

    if (!binary.trim()) throw new Error("binary is required");
    const result = await runCommand({ binary, args, cwd, env, timeoutMs: body.timeoutMs });
    return { result, ranAt: new Date().toISOString() };
  });
}
