import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { dockerHosts } from "@/db/schema";
import { envFirst } from "@/lib/env";
import { invalidateEngineCaches } from "./state";
import type { EngineEndpointInfo } from "./types";

export function inferKind(endpoint: string): EngineEndpointInfo["kind"] {
  if (endpoint.startsWith("tcp://") || endpoint.startsWith("http://") || endpoint.startsWith("https://")) return "tcp";
  if (endpoint.startsWith("npipe://")) return "npipe";
  return "unix";
}

export function socketPathOf(endpoint: string): string | null {
  if (endpoint.startsWith("unix://")) return endpoint.replace("unix://", "");
  if (endpoint.startsWith("npipe://")) return endpoint.replace("npipe://", "//");
  return null;
}

export function defaultEndpoint(): string {
  return envFirst(["DOCKER_HOST", "DOCKER_SOCKET"], "unix:///var/run/docker.sock");
}

function toInfo(row: typeof dockerHosts.$inferSelect): EngineEndpointInfo {
  return {
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    kind: row.kind,
    isDefault: row.isDefault,
  };
}

/** Seeds the registry from env on first run; safe to call on every request. */
export async function ensureEndpoints(): Promise<EngineEndpointInfo[]> {
  const existing = await listEndpoints();
  if (existing.length > 0) return existing;

  const endpoint = defaultEndpoint();
  await db
    .insert(dockerHosts)
    .values({
      id: randomUUID(),
      name: existing.length === 0 ? "local socket" : "endpoint",
      endpoint,
      kind: inferKind(endpoint),
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
  invalidateEngineCaches();
  return listEndpoints();
}

export async function listEndpoints(): Promise<EngineEndpointInfo[]> {
  const rows = await db.select().from(dockerHosts).orderBy(asc(dockerHosts.createdAt));
  if (!rows.length) return [];
  const hasDefault = rows.some((row) => row.isDefault);
  return rows
    .map(toInfo)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
    .map((info, index) => ({ ...info, isDefault: hasDefault ? info.isDefault : index === 0 }));
}

export async function addEndpoint(input: { name?: string; endpoint: string; makeDefault?: boolean }): Promise<EngineEndpointInfo> {
  const endpoint = input.endpoint.trim();
  if (!/^(unix|tcp|npipe|https?):\/\//.test(endpoint)) {
    throw new Error("endpoint must start with unix://, tcp:// or npipe://");
  }
  const rows = await listEndpoints();
  const makeDefault = input.makeDefault ?? rows.length === 0;
  if (makeDefault) {
    await db.update(dockerHosts).set({ isDefault: false });
  }
  const [row] = await db
    .insert(dockerHosts)
    .values({
      id: randomUUID(),
      name: input.name?.trim() || endpoint.replace(/^[a-z]+:\/\//, ""),
      endpoint,
      kind: inferKind(endpoint),
      isDefault: makeDefault,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  invalidateEngineCaches();
  return toInfo(row);
}

export async function removeEndpoint(id: string): Promise<void> {
  await db.delete(dockerHosts).where(eq(dockerHosts.id, id));
  const remaining = await listEndpoints();
  if (remaining.length && !remaining.some((entry) => entry.isDefault)) {
    await db.update(dockerHosts).set({ isDefault: true }).where(eq(dockerHosts.id, remaining[0].id));
  }
  invalidateEngineCaches();
}

export async function setDefaultEndpoint(id: string): Promise<void> {
  const rows = await db.select().from(dockerHosts);
  if (!rows.some((row) => row.id === id)) throw new Error("endpoint not found");
  await db.update(dockerHosts).set({ isDefault: false });
  await db.update(dockerHosts).set({ isDefault: true, updatedAt: new Date() }).where(eq(dockerHosts.id, id));
  invalidateEngineCaches();
}

export function endpointReachable(endpoint: string): boolean {
  const socket = socketPathOf(endpoint);
  if (!socket) return true;
  if (process.platform !== "win32" && !existsSync(socket)) return false;
  return true;
}
