import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { cliTools } from "@/db/schema";
import { guard, readJson, requireString } from "@/lib/api";

export const dynamic = "force-dynamic";

const SEED = [
  { name: "engine containers", binary: "docker", baseArgs: "ps -a --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'", category: "engine", favourite: true },
  { name: "compose projects", binary: "docker", baseArgs: "compose ls", category: "engine", favourite: true },
  { name: "engine disk usage", binary: "docker", baseArgs: "system df -v", category: "engine", favourite: false },
  { name: "engine info", binary: "docker", baseArgs: "info", category: "engine", favourite: false },
  { name: "compose services", binary: "docker", baseArgs: "compose ps", category: "compose", favourite: false },
  { name: "node version", binary: "node", baseArgs: "--version", category: "runtime", favourite: false },
  { name: "git status", binary: "git", baseArgs: "status --short --branch", category: "scm", favourite: true },
  { name: "health probe", binary: "curl", baseArgs: "-sS -m 4 http://127.0.0.1:3000/api/health", category: "utility", favourite: false },
  { name: "list java processes", binary: "java", baseArgs: "-version", category: "runtime", favourite: false },
  { name: "terraform version", binary: "terraform", baseArgs: "version", category: "iac", favourite: false },
];

async function ensureSeed(): Promise<void> {
  const existing = await db.select({ id: cliTools.id }).from(cliTools).limit(1);
  if (existing.length) return;
  await db.insert(cliTools).values(
    SEED.map((tool) => ({
      id: randomUUID(),
      name: tool.name,
      binary: tool.binary,
      baseArgs: tool.baseArgs,
      category: tool.category,
      favourite: tool.favourite,
      env: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
}

export async function GET() {
  return guard(async () => {
    await ensureSeed();
    const tools = await db.select().from(cliTools).orderBy(desc(cliTools.favourite), cliTools.category, cliTools.name);
    return { tools };
  });
}

export async function POST(request: Request) {
  return guard(async () => {
    const body = await readJson<{ name?: string; binary?: string; baseArgs?: string; cwd?: string; env?: Record<string, string>; category?: string }>(request);
    const [tool] = await db
      .insert(cliTools)
      .values({
        id: randomUUID(),
        name: requireString(body.name, "name"),
        binary: requireString(body.binary, "binary"),
        baseArgs: body.baseArgs ?? "",
        cwd: body.cwd || null,
        env: body.env ?? {},
        category: body.category || "general",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return { tool };
  });
}

export async function PATCH(request: Request) {
  return guard(async () => {
    const body = await readJson<{
      id?: string;
      name?: string;
      binary?: string;
      baseArgs?: string;
      cwd?: string;
      env?: Record<string, string>;
      category?: string;
      favourite?: boolean;
    }>(request);
    const id = requireString(body.id, "id");
    const [tool] = await db
      .update(cliTools)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.binary !== undefined ? { binary: body.binary } : {}),
        ...(body.baseArgs !== undefined ? { baseArgs: body.baseArgs } : {}),
        ...(body.cwd !== undefined ? { cwd: body.cwd || null } : {}),
        ...(body.env !== undefined ? { env: body.env } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.favourite !== undefined ? { favourite: body.favourite } : {}),
        updatedAt: new Date(),
      })
      .where(eq(cliTools.id, id))
      .returning();
    if (!tool) throw new Error("tool not found");
    return { tool };
  });
}

export async function DELETE(request: Request) {
  return guard(async () => {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) throw new Error("id is required");
    await db.delete(cliTools).where(eq(cliTools.id, id));
    return { ok: true };
  });
}
