import { eq } from "drizzle-orm";
import { db } from "@/db";
import { configSources } from "@/db/schema";
import { HttpError } from "@/lib/api";
import { envOr } from "@/lib/env";
import { DEMO_COMPOSE, parseCompose } from "./compose";
import { clearGithubCache, fetchGithubModel, fixtureGithubModel, hasToken } from "./github";
import { DEMO_TERRAFORM, parseTerraformDirectory, parseTerraformSource } from "./terraform";
import { readCapped, resolveInsideRoot, scanWorkspace } from "./scan";
import type { ComposeModel, ConfigSourceKind, ConfigSourceRow, GithubModel, TerraformModel } from "./types";

export const MAX_COMPOSE_BYTES = 1024 * 1024;

export function configRoot(): string {
  return envOr("CONFIG_ROOT", envOr("WORKSPACE_ROOT", process.cwd()));
}

export function sourceRow(row: typeof configSources.$inferSelect): ConfigSourceRow {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    target: row.target,
    status: row.status,
    lastError: row.lastError ?? null,
    lastLoadedAt: row.lastLoadedAt ? Math.floor(new Date(row.lastLoadedAt).getTime() / 1000) : null,
    summary: row.summary ?? null,
  };
}

export async function listSources(): Promise<ConfigSourceRow[]> {
  const rows = await db.select().from(configSources);
  return rows.map(sourceRow).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSource(id: string): Promise<typeof configSources.$inferSelect> {
  const [row] = await db.select().from(configSources).where(eq(configSources.id, id)).limit(1);
  if (!row) throw new HttpError(404, `config source ${id} not found`);
  return row;
}

export async function deleteSource(id: string): Promise<void> {
  await getSource(id);
  await db.delete(configSources).where(eq(configSources.id, id));
}

export interface SaveSourceInput {
  name: string;
  kind: ConfigSourceKind;
  target: string;
  content?: string | null;
  summary?: Record<string, unknown> | null;
  status?: string;
  lastError?: string | null;
}

export async function saveSource(input: SaveSourceInput): Promise<ConfigSourceRow> {
  const [row] = await db
    .insert(configSources)
    .values({
      name: input.name,
      kind: input.kind,
      target: input.target,
      content: input.content ?? null,
      summary: input.summary ?? null,
      status: input.status ?? "loaded",
      lastError: input.lastError ?? null,
      lastLoadedAt: new Date(),
    })
    .returning();
  return sourceRow(row);
}

export async function touchSource(
  id: string,
  patch: { status?: string; lastError?: string | null; summary?: Record<string, unknown> | null },
): Promise<void> {
  await db
    .update(configSources)
    .set({
      status: patch.status ?? "loaded",
      lastError: patch.lastError ?? null,
      summary: patch.summary ?? null,
      lastLoadedAt: new Date(),
    })
    .where(eq(configSources.id, id));
}

/* -------------------------------------------------------------- compose */

export async function loadCompose(input: { content?: string | null; path?: string | null }): Promise<ComposeModel> {
  if (input.content && input.content.trim()) {
    return parseCompose(input.content, "docker-compose.yml");
  }
  if (input.path) {
    const file = await resolveInsideRoot(configRoot(), input.path);
    const { content, truncated } = await readCapped(file, MAX_COMPOSE_BYTES);
    if (truncated) throw new HttpError(413, `${input.path} is larger than 1 MB — refusing to parse.`);
    return parseCompose(content, file.split("/").pop() ?? "docker-compose.yml");
  }
  return parseCompose(DEMO_COMPOSE, "demo-compose.yml");
}

/* ------------------------------------------------------------ terraform */

export async function loadTerraform(input: { dir?: string | null; files?: Record<string, string> | null }): Promise<TerraformModel> {
  if (input.files && Object.keys(input.files).length) {
    return parseTerraformSource(input.dir ?? "uploaded", input.files);
  }
  if (input.dir) {
    const directory = await resolveInsideRoot(configRoot(), input.dir);
    return parseTerraformDirectory(directory).catch((error: unknown) => {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    });
  }
  return parseTerraformSource("demo-terraform", DEMO_TERRAFORM);
}

/* --------------------------------------------------------------- github */

export async function loadGithub(repo: string, options: { fixture?: boolean; refresh?: boolean } = {}): Promise<GithubModel> {
  const target = repo.trim() || "vega-labs/dockflow";
  if (options.refresh) clearGithubCache();
  if (options.fixture) return fixtureGithubModel(target, "Fixture mode — no GitHub request was made.");

  try {
    return await fetchGithubModel(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isNetwork = error instanceof HttpError ? error.status >= 500 || error.status === 429 : true;
    if (!isNetwork) throw error;
    // Network/rate-limit failures degrade to the offline fixture, loudly.
    return fixtureGithubModel(target, `${message} Falling back to the bundled offline fixture.`);
  }
}

export function githubConfigured(): { token: boolean } {
  return { token: hasToken() };
}

/* ------------------------------------------------------------ workspace */

export async function loadWorkspace(target?: string | null) {
  const root = target ? await resolveInsideRoot(configRoot(), target) : configRoot();
  return scanWorkspace(root);
}

/* --------------------------------------------------------- source → model */

export type ConfigModel = ComposeModel | TerraformModel | GithubModel;

export async function modelForSource(row: typeof configSources.$inferSelect): Promise<ConfigModel> {
  switch (row.kind) {
    case "compose":
      return loadCompose(row.content ? { content: row.content } : { path: row.target });
    case "terraform":
      return loadTerraform({ dir: row.target });
    case "github":
      return loadGithub(row.target);
    case "workspace":
    case "dockerfile":
      throw new HttpError(400, `${row.kind} sources are scanned for candidates, not rendered as a graph`);
    default:
      throw new HttpError(400, `unsupported config source kind: ${row.kind}`);
  }
}
