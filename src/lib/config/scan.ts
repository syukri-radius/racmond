import { open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "@/lib/api";

/** Directories never worth walking in a workspace scan. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  ".cache",
  ".terraform",
  "vendor",
]);

const MAX_DEPTH = 6;
const MAX_ENTRIES = 4000;
const MAX_FILES = 200;

export interface ScanHit {
  kind: "compose" | "terraform" | "dockerfile";
  path: string;
  relative: string;
  label: string;
  size: number | null;
}

export interface ScanResult {
  root: string;
  hits: ScanHit[];
  counts: { compose: number; terraform: number; dockerfile: number };
  scanned: number;
  truncated: boolean;
  skipped: string[];
  durationMs: number;
}

/**
 * Resolves `target` inside `root` and refuses anything that escapes it.
 * The check runs on the realpath so `../` and symlinks cannot break out.
 */
export async function resolveInsideRoot(root: string, target: string): Promise<string> {
  const rootReal = await realpath(path.resolve(root)).catch(() => {
    throw new HttpError(400, `root directory does not exist: ${root}`);
  });
  const candidate = path.resolve(rootReal, target.replace(/^\/+/, ""));
  const candidateReal = await realpath(candidate).catch(() => candidate);
  const prefix = rootReal.endsWith(path.sep) ? rootReal : `${rootReal}${path.sep}`;
  if (candidateReal !== rootReal && !candidateReal.startsWith(prefix)) {
    throw new HttpError(403, `path escapes the configured root: ${target}`);
  }
  return candidateReal;
}

/** Reads a file but refuses anything over `maxBytes` (checked before buffering). */
export async function readCapped(file: string, maxBytes: number): Promise<{ content: string; size: number; truncated: boolean }> {
  const info = await stat(file);
  if (!info.isFile()) throw new HttpError(400, `${file} is not a file`);
  const handle = await open(file, "r");
  try {
    const limit = Math.min(info.size, maxBytes);
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return {
      content: buffer.subarray(0, bytesRead).toString("utf8"),
      size: info.size,
      truncated: info.size > maxBytes,
    };
  } finally {
    await handle.close();
  }
}

function isComposeFile(name: string): boolean {
  return /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/i.test(name) || /^compose\.ya?ml$/i.test(name);
}

function isTerraformFile(name: string): boolean {
  return name.endsWith(".tf") || name.endsWith(".tfvars");
}

function isDockerfile(name: string): boolean {
  return /^(dockerfile|containerfile)(\.[\w-]+)?$/i.test(name);
}

export async function scanWorkspace(root: string): Promise<ScanResult> {
  const started = Date.now();
  const rootReal = await realpath(path.resolve(root)).catch(() => {
    throw new HttpError(400, `workspace root does not exist: ${root}`);
  });
  const info = await stat(rootReal);
  if (!info.isDirectory()) throw new HttpError(400, `${root} is not a directory`);

  const hits: ScanHit[] = [];
  const skipped: string[] = [];
  const terraformDirs = new Set<string>();
  let scanned = 0;
  let truncated = false;

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (scanned >= MAX_ENTRIES || hits.length >= MAX_FILES) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      skipped.push(`${path.relative(rootReal, directory) || "."} (unreadable)`);
      return;
    }
    for (const entry of entries) {
      if (scanned >= MAX_ENTRIES) {
        truncated = true;
        return;
      }
      scanned += 1;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(rootReal, absolute) || entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        if (depth >= MAX_DEPTH) continue;
        await walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      let size: number | null = null;
      try {
        size = (await stat(absolute)).size;
      } catch {
        size = null;
      }
      if (isComposeFile(entry.name)) {
        hits.push({ kind: "compose", path: absolute, relative, label: entry.name, size });
      } else if (isTerraformFile(entry.name)) {
        if (!terraformDirs.has(directory)) {
          terraformDirs.add(directory);
          hits.push({
            kind: "terraform",
            path: directory,
            relative: path.relative(rootReal, directory) || ".",
            label: path.relative(rootReal, directory) || ".",
            size: null,
          });
        }
      } else if (isDockerfile(entry.name)) {
        hits.push({ kind: "dockerfile", path: absolute, relative, label: entry.name, size });
      }
    }
  };

  await walk(rootReal, 0);

  hits.sort((a, b) => a.relative.localeCompare(b.relative));
  return {
    root: rootReal,
    hits,
    counts: {
      compose: hits.filter((hit) => hit.kind === "compose").length,
      terraform: hits.filter((hit) => hit.kind === "terraform").length,
      dockerfile: hits.filter((hit) => hit.kind === "dockerfile").length,
    },
    scanned,
    truncated,
    skipped,
    durationMs: Date.now() - started,
  };
}
