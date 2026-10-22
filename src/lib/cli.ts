import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { envOr } from "@/lib/env";

/**
 * CLI execution layer.
 *
 * Hygiene:
 *  - argv arrays only, `shell: false` (never string concatenation)
 *  - a quote-aware tokenizer for the free-text args field
 *  - 30s default timeout (hard max 120s) killed with SIGKILL
 *  - output byte budget with a `truncated` flag
 *  - a deny-list for destructive commands
 */

export interface RunOptions {
  binary: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface RunResult {
  binary: string;
  argv: string[];
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  output: string;
  truncated: boolean;
  timedOut: boolean;
  blocked?: string;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_BYTES = 256 * 1024;

/** Quote-aware argv tokenizer: supports "double", 'single' and backslash escapes. */
export function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let hasContent = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }
      if (char === "\\" && quote === '"' && i + 1 < input.length) {
        current += input[i + 1];
        i += 1;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasContent = true;
      continue;
    }
    if (char === "\\" && i + 1 < input.length) {
      current += input[i + 1];
      i += 1;
      hasContent = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (current || hasContent) {
        tokens.push(current);
        current = "";
        hasContent = false;
      }
      continue;
    }
    current += char;
    hasContent = true;
  }
  if (current || hasContent) tokens.push(current);
  return tokens;
}

const DENY_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bmkfs(\.\w+)?\b/i, reason: "filesystem formatting is not allowed" },
  { pattern: /\bmke2fs\b/i, reason: "filesystem formatting is not allowed" },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: "host power control is not allowed" },
  { pattern: /\bdd\b[^\n]*\bof=\/dev\/(sd|nvme|hd|vd)/i, reason: "raw device writes are not allowed" },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/, reason: "fork bombs are not allowed" },
  { pattern: /\brm\s+(-[a-zA-Z]*\s+)*-?[a-zA-Z]*[rf][a-zA-Z]*\s+\/(\s|$)/i, reason: "rm -rf / is not allowed" },
  { pattern: /\bchmod\s+-R\s+777\s+\/(\s|$)/i, reason: "recursive chmod on / is not allowed" },
  { pattern: />\s*\/dev\/(sd|nvme|hd|vd)/i, reason: "raw device writes are not allowed" },
];

export function screenCommand(binary: string, args: string[]): string | null {
  const joined = `${binary} ${args.join(" ")}`;
  for (const rule of DENY_PATTERNS) {
    if (rule.pattern.test(joined)) return rule.reason;
  }
  if (!/^[a-zA-Z0-9._/-]+$/.test(binary)) return "binary name contains unsupported characters";
  return null;
}

export function resolveCwd(cwd?: string): string {
  if (!cwd || !cwd.trim()) return process.cwd();
  const resolved = path.resolve(cwd.trim());
  return resolved;
}

function appendChunk(state: { chunks: Buffer[]; bytes: number; truncated: boolean }, chunk: Buffer, maxBytes: number): void {
  if (state.bytes >= maxBytes) {
    state.truncated = true;
    return;
  }
  const remaining = maxBytes - state.bytes;
  if (chunk.length > remaining) {
    state.chunks.push(chunk.subarray(0, remaining));
    state.bytes = maxBytes;
    state.truncated = true;
    return;
  }
  state.chunks.push(chunk);
  state.bytes += chunk.length;
}

export async function runCommand(options: RunOptions): Promise<RunResult> {
  const binary = options.binary.trim();
  const args = options.args ?? [];
  const cwd = resolveCwd(options.cwd);
  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const started = Date.now();

  const blocked = screenCommand(binary, args);
  if (blocked) {
    return {
      binary,
      argv: args,
      cwd,
      exitCode: null,
      signal: null,
      durationMs: 0,
      stdout: "",
      stderr: blocked,
      output: blocked,
      truncated: false,
      timedOut: false,
      blocked,
    };
  }

  return new Promise<RunResult>((resolve) => {
    const out = { chunks: [] as Buffer[], bytes: 0, truncated: false };
    const err = { chunks: [] as Buffer[], bytes: 0, truncated: false };
    let timedOut = false;
    let settled = false;

    let child;
    try {
      child = spawn(binary, args, {
        cwd,
        shell: false,
        env: { ...process.env, ...(options.env ?? {}) },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        binary,
        argv: args,
        cwd,
        exitCode: 127,
        signal: null,
        durationMs: Date.now() - started,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        output: error instanceof Error ? error.message : String(error),
        truncated: false,
        timedOut: false,
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(out.chunks).toString("utf8");
      const stderr = Buffer.concat(err.chunks).toString("utf8");
      resolve({
        binary,
        argv: args,
        cwd,
        exitCode,
        signal,
        durationMs: Date.now() - started,
        stdout,
        stderr,
        output: [stdout, stderr].filter(Boolean).join(stdout && stderr ? "\n" : ""),
        truncated: out.truncated || err.truncated,
        timedOut,
      });
    };

    child.stdout?.on("data", (chunk: Buffer) => appendChunk(out, chunk, maxBytes));
    child.stderr?.on("data", (chunk: Buffer) => appendChunk(err, chunk, maxBytes));
    child.on("error", (error: NodeJS.ErrnoException) => {
      const message =
        error.code === "ENOENT"
          ? `${binary}: not found on PATH`
          : `${binary}: ${error.message}`;
      err.chunks.push(Buffer.from(message));
      finish(127, null);
    });
    child.on("close", (code, signal) => finish(code, signal));
  });
}

/* ------------------------------------------------------------- detection */

export interface BinaryInfo {
  name: string;
  installed: boolean;
  version: string | null;
  path: string | null;
  category: string;
  error?: string;
}

export const CANDIDATE_BINARIES: { name: string; category: string; args?: string[] }[] = [
  { name: "docker", category: "engine", args: ["--version"] },
  { name: "docker-compose", category: "engine", args: ["--version"] },
  { name: "node", category: "runtime", args: ["--version"] },
  { name: "npm", category: "runtime", args: ["--version"] },
  { name: "pnpm", category: "runtime", args: ["--version"] },
  { name: "git", category: "scm", args: ["--version"] },
  { name: "kubectl", category: "orchestration", args: ["version", "--client=true", "--short"] },
  { name: "helm", category: "orchestration", args: ["version", "--short"] },
  { name: "terraform", category: "iac", args: ["version"] },
  { name: "jq", category: "utility", args: ["--version"] },
  { name: "curl", category: "utility", args: ["--version"] },
  { name: "psql", category: "database", args: ["--version"] },
  { name: "redis-cli", category: "database", args: ["--version"] },
  { name: "java", category: "runtime", args: ["-version"] },
  { name: "python3", category: "runtime", args: ["--version"] },
  { name: "go", category: "runtime", args: ["version"] },
  { name: "cargo", category: "runtime", args: ["--version"] },
  { name: "mvn", category: "build", args: ["-v"] },
  { name: "gradle", category: "build", args: ["--version"] },
  { name: "make", category: "build", args: ["--version"] },
];

async function whichPath(binary: string): Promise<string | null> {
  const dirs = envOr("PATH", "/usr/local/bin:/usr/bin:/bin").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, binary);
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * A failed spawn still prints something ("not found on PATH"), so availability
 * is decided by an actual `--version` run: installed only on exit 0 (or 1 for
 * tools like java that print version to stderr) with real output.
 */
export async function detectBinary(binary: string, args: string[] = ["--version"]): Promise<BinaryInfo> {
  const category = CANDIDATE_BINARIES.find((entry) => entry.name === binary)?.category ?? "utility";
  const resolved = await whichPath(binary);
  if (!resolved) {
    return { name: binary, installed: false, version: null, path: null, category, error: `${binary}: not found on PATH` };
  }
  const result = await runCommand({ binary, args, timeoutMs: 6000, maxBytes: 64 * 1024 });
  const text = `${result.stdout}\n${result.stderr}`.trim();
  const installed = !result.blocked && result.exitCode !== 127 && text.length > 0 && !/not found on PATH/i.test(text);
  return {
    name: binary,
    installed,
    version: installed ? text.split("\n")[0].slice(0, 160) : null,
    path: resolved,
    category,
    error: installed ? undefined : text.slice(0, 160) || "no version output",
  };
}

export async function detectBinaries(limit = 12): Promise<BinaryInfo[]> {
  const subset = CANDIDATE_BINARIES.slice(0, limit);
  return Promise.all(subset.map((entry) => detectBinary(entry.name, entry.args)));
}
