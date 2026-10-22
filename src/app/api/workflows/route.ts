import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { guard, readJson } from "@/lib/api";
import { DEFAULT_GRAPH } from "@/lib/workflows/registry";

export const dynamic = "force-dynamic";

async function ensureSeed(): Promise<void> {
  const rows = await db.select({ id: workflows.id }).from(workflows).limit(1);
  if (rows.length) return;
  await db.insert(workflows).values({
    id: randomUUID(),
    name: "Container triage",
    description: "Healthcheck, log assertions and a container probe — the demo workflow.",
    nodes: DEFAULT_GRAPH.nodes as unknown as unknown[],
    edges: DEFAULT_GRAPH.edges as unknown as unknown[],
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function GET() {
  return guard(async () => {
    await ensureSeed();
    const rows = await db.select().from(workflows).orderBy(desc(workflows.updatedAt));
    return { workflows: rows };
  });
}

export async function POST(request: Request) {
  return guard(async () => {
    const body = await readJson<{ name?: string; description?: string; nodes?: unknown[]; edges?: unknown[]; cloneOf?: string }>(request);
    if (body.cloneOf) {
      const [original] = await db.select().from(workflows).where(eq(workflows.id, body.cloneOf));
      if (!original) throw new Error("workflow to clone not found");
      const [clone] = await db
        .insert(workflows)
        .values({
          id: randomUUID(),
          name: `${original.name} (copy)`,
          description: original.description,
          nodes: original.nodes,
          edges: original.edges,
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      return { workflow: clone };
    }
    const [workflow] = await db
      .insert(workflows)
      .values({
        id: randomUUID(),
        name: body.name?.trim() || "Untitled workflow",
        description: body.description ?? null,
        nodes: (body.nodes ?? DEFAULT_GRAPH.nodes) as unknown[],
        edges: (body.edges ?? DEFAULT_GRAPH.edges) as unknown[],
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return { workflow };
  });
}
