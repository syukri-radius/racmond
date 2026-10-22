import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workflowRuns, workflows } from "@/db/schema";
import { getEngine } from "@/lib/docker/service";
import { runCommand, tokenizeArgs } from "@/lib/cli";
import { withTimeout } from "@/lib/cache";
import type { WorkflowGraphEdge, WorkflowGraphNode, WorkflowStep } from "./types";
import { definitionOf } from "./registry";

/**
 * Server-side workflow runner: trigger first, then BFS over outgoing edges.
 * Steps are persisted after every transition so the UI can poll and paint
 * per-step status onto the canvas and the timeline.
 */

type Outputs = Record<string, unknown>;

const MAX_STEP_MS = 60_000;

/* ------------------------------------------------------------ templating */

function lookup(path: string, outputs: Map<string, Outputs>, trigger: Outputs): unknown {
  const parts = path.split(".").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return undefined;

  // bare {{container}} shorthand → trigger payload value
  if (parts.length === 1) {
    if (parts[0] in trigger) return trigger[parts[0]];
    const only = Array.from(outputs.values()).find((entry) => parts[0] in entry);
    return only?.[parts[0]];
  }

  const [nodeId, ...rest] = parts;
  const nodeOutput = outputs.get(nodeId);
  if (!nodeOutput) return trigger[path];
  let value: unknown = nodeOutput;
  for (const key of rest) {
    if (value && typeof value === "object" && key in (value as Record<string, unknown>)) {
      value = (value as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return value;
}

export function renderTemplate(input: unknown, outputs: Map<string, Outputs>, trigger: Outputs): string {
  if (typeof input !== "string") return input === undefined || input === null ? "" : String(input);
  return input.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, path: string) => {
    const value = lookup(path, outputs, trigger);
    if (value === undefined || value === null) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
}

function parseEnv(text: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    out[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1);
  }
  return out;
}

function compare(left: string, operator: string, right: string): boolean {
  const numeric = Number(left);
  const numericRight = Number(right);
  const useNumbers = Number.isFinite(numeric) && Number.isFinite(numericRight) && left.trim() !== "" && right.trim() !== "";
  switch (operator) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case ">":
      return useNumbers ? numeric > numericRight : left > right;
    case ">=":
      return useNumbers ? numeric >= numericRight : left >= right;
    case "<":
      return useNumbers ? numeric < numericRight : left < right;
    case "<=":
      return useNumbers ? numeric <= numericRight : left <= right;
    case "contains":
      return left.includes(right);
    case "matches":
      try {
        return new RegExp(right).test(left);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/* -------------------------------------------------------------- executor */

async function executeStep(
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  outputs: Map<string, Outputs>,
  trigger: Outputs,
): Promise<{ output: string; exitCode: number | null; data?: Record<string, unknown>; ok: boolean }> {
  const get = (key: string) => renderTemplate(config[key], outputs, trigger);
  const num = (key: string, fallback: number) => {
    const value = Number(get(key));
    return Number.isFinite(value) && value !== 0 ? value : fallback;
  };

  switch (node.type) {
    case "trigger": {
      const data: Outputs = {
        container: get("container"),
        image: get("image"),
        note: get("note"),
        manual: Boolean(config.manual ?? true),
        startedAt: new Date().toISOString(),
        ...trigger,
      };
      return { output: `trigger payload → ${JSON.stringify(data).slice(0, 400)}`, exitCode: 0, data, ok: true };
    }

    case "dockerAction": {
      const { adapter } = await getEngine();
      const action = get("action") || "restart";
      const target = get("target");
      const result = await adapter.action(action, `container:${target}`);
      return { output: result.message, exitCode: 0, data: { message: result.message, action, target }, ok: true };
    }

    case "dockerRun": {
      const { adapter } = await getEngine();
      const ports = get("ports").split(",").map((entry) => entry.trim()).filter(Boolean);
      const env = parseEnv(get("env"));
      const result = await adapter.run({
        image: get("image"),
        name: get("name") || undefined,
        ports,
        env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
        command: get("command") || undefined,
      });
      return {
        output: `started ${result.name} (${result.id.slice(0, 12)})`,
        exitCode: 0,
        data: { id: result.id, name: result.name },
        ok: true,
      };
    }

    case "dockerExec": {
      const { adapter } = await getEngine();
      const result = await adapter.exec(get("container"), get("command"));
      const ok = result.exitCode === 0;
      return {
        output: result.output,
        exitCode: result.exitCode,
        data: { exitCode: result.exitCode, output: result.output, durationMs: result.durationMs },
        ok,
      };
    }

    case "dockerLogs": {
      const { adapter } = await getEngine();
      const tail = Math.min(2000, Math.max(10, num("tail", 200)));
      const logs = await adapter.logs(get("container"), { tail, timestamps: true });
      const require = get("require").trim();
      const forbid = get("forbid").trim();
      const lines = logs ? logs.split("\n").length : 0;
      const missing = require !== "" && !logs.toLowerCase().includes(require.toLowerCase());
      const foundForbidden = forbid !== "" && logs.toLowerCase().includes(forbid.toLowerCase());
      const ok = !missing && !foundForbidden;
      const verdict = missing
        ? `required pattern "${require}" not found`
        : foundForbidden
          ? `forbidden pattern "${forbid}" found`
          : "log assertions passed";
      return {
        output: `${lines} lines · ${verdict}\n\n${logs.slice(0, 4000)}`,
        exitCode: ok ? 0 : 1,
        data: { lines, matched: ok, logs: logs.slice(0, 20000) },
        ok,
      };
    }

    case "healthcheck": {
      const url = get("url");
      const expect = num("expect", 200);
      const retries = Math.min(10, Math.max(1, num("retries", 3)));
      const interval = Math.min(10_000, Math.max(100, num("intervalMs", 500)));
      const timeout = Math.min(20_000, Math.max(500, num("timeoutMs", 4000)));
      let status = 0;
      let body = "";
      let attempts = 0;
      let ok = false;
      for (let attempt = 1; attempt <= retries; attempt += 1) {
        attempts = attempt;
        try {
          const response = await withTimeout(fetch(url), timeout, "healthcheck");
          status = response.status;
          body = (await response.text()).slice(0, 2000);
          if (status === expect) {
            ok = true;
            break;
          }
        } catch (error) {
          body = error instanceof Error ? error.message : String(error);
        }
        if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, interval));
      }
      return {
        output: `HTTP ${status || "error"} after ${attempts} attempt(s) — expected ${expect}${ok ? "" : " (failed)"}\n${body.slice(0, 600)}`,
        exitCode: ok ? 0 : 1,
        data: { status, ok, attempts, body: body.slice(0, 4000) },
        ok,
      };
    }

    case "cli": {
      const args = tokenizeArgs(get("args"));
      const result = await runCommand({
        binary: get("binary"),
        args,
        cwd: get("cwd") || undefined,
        env: parseEnv(get("env")),
        timeoutMs: num("timeoutMs", 30_000),
      });
      const ok = result.exitCode === 0 && !result.blocked;
      return {
        output: result.output || (ok ? "(no output)" : `exit ${result.exitCode}`),
        exitCode: result.exitCode,
        data: { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs },
        ok,
      };
    }

    case "http": {
      const url = get("url");
      const method = get("method") || "GET";
      const expect = num("expect", 200);
      const headers = parseEnv(get("headers"));
      const body = get("body");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), MAX_STEP_MS);
      try {
        const response = await fetch(url, {
          method,
          headers,
          body: ["GET", "HEAD"].includes(method) || !body ? undefined : body,
          signal: controller.signal,
        });
        const text = (await response.text()).slice(0, 8000);
        const ok = response.status === expect;
        return {
          output: `${method} ${url} → ${response.status}${ok ? "" : ` (expected ${expect})`}\n${text.slice(0, 800)}`,
          exitCode: ok ? 0 : 1,
          data: { status: response.status, ok, body: text },
          ok,
        };
      } finally {
        clearTimeout(timer);
      }
    }

    case "delay": {
      const ms = Math.min(30_000, Math.max(0, num("ms", 1000)));
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { output: `waited ${ms}ms`, exitCode: 0, data: { waitedMs: ms }, ok: true };
    }

    case "condition": {
      const left = get("left");
      const right = get("right");
      const operator = get("operator") || "==";
      const result = compare(left, operator, right);
      return {
        output: `${left} ${operator} ${right} → ${result}`,
        exitCode: 0,
        data: { result, left, right },
        ok: true,
      };
    }

    case "notify": {
      const message = get("message");
      const channel = get("channel") || "operator";
      return {
        output: `[${channel}] ${message}`,
        exitCode: 0,
        data: { delivered: true, channel, message },
        ok: true,
      };
    }

    default:
      return { output: `unsupported step ${node.type}`, exitCode: 1, ok: false };
  }
}

/* ----------------------------------------------------------------- runner */

function labelFor(node: WorkflowGraphNode): string {
  const definition = definitionOf(node.type);
  return node.data?.label?.trim() || definition.label;
}

export async function executeWorkflowRun(runId: string, workflowName: string | null): Promise<void> {
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
  if (!run) return;
  const workflowId = run.workflowId;
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, workflowId));
  if (!workflow) {
    await db.update(workflowRuns).set({ status: "failed", error: "workflow not found", finishedAt: new Date() }).where(eq(workflowRuns.id, runId));
    return;
  }

  const nodes = (workflow.nodes ?? []) as unknown as WorkflowGraphNode[];
  const edges = (workflow.edges ?? []) as unknown as WorkflowGraphEdge[];
  const triggerNode = nodes.find((node) => node.type === "trigger") ?? nodes[0];
  const trigger = (run.trigger ?? {}) as Outputs;

  const steps = new Map<string, WorkflowStep>();
  for (const node of nodes) {
    steps.set(node.id, {
      nodeId: node.id,
      type: node.type,
      label: labelFor(node),
      status: "pending",
      startedAt: null,
      finishedAt: null,
      durationMs: 0,
      output: "",
      exitCode: null,
      error: null,
    });
  }

  const outputs = new Map<string, Outputs>();
  const failed = new Set<string>();
  const skipped = new Set<string>();
  const branchOf = new Map<string, string>();

  const persist = async (status: WorkflowRunRowStatus, error: string | null = null) => {
    await db
      .update(workflowRuns)
      .set({
        status,
        steps: Array.from(steps.values()) as unknown as unknown[],
        error,
        ...(status === "running" ? {} : { finishedAt: new Date() }),
      })
      .where(eq(workflowRuns.id, runId));
  };

  const isCancelled = async (): Promise<boolean> => {
    const [current] = await db
      .select({ cancelRequested: workflowRuns.cancelRequested })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId));
    return Boolean(current?.cancelRequested);
  };

  await persist("running");

  if (!triggerNode) {
    await persist("failed", "workflow has no nodes");
    return;
  }

  const queue: { node: WorkflowGraphNode; from: string | null }[] = [{ node: triggerNode, from: null }];
  const visited = new Set<string>();

  while (queue.length) {
    if (await isCancelled()) {
      for (const step of steps.values()) {
        if (step.status === "pending") step.status = "cancelled";
      }
      await persist("cancelled");
      return;
    }

    const { node, from } = queue.shift()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);

    const step = steps.get(node.id)!;
    const incoming = edges.filter((edge) => edge.target === node.id);

    // a node fails to run when an upstream failed, or its labelled branch was not taken
    const blockedByFailure = incoming.some((edge) => failed.has(edge.source) || skipped.has(edge.source));
    const blockedByBranch = incoming.some((edge) => {
      const chosen = branchOf.get(edge.source);
      if (!chosen) return false;
      const label = (edge.label ?? "").trim().toLowerCase();
      return label !== "" && label !== chosen;
    });

    if (blockedByFailure || blockedByBranch) {
      step.status = "skipped";
      step.output = blockedByBranch ? "branch not taken" : "upstream step failed";
      step.finishedAt = Date.now();
      skipped.add(node.id);
      await persist("running");
      continue;
    }

    step.status = "running";
    step.startedAt = Date.now();
    await persist("running");

    const startedAt = Date.now();
    try {
      const config = { ...(node.data?.config ?? {}) };
      const result = await executeStep(node, config, outputs, node.id === triggerNode.id ? trigger : trigger);
      const data = { ...(result.data ?? {}) };
      if (node.type === "trigger") {
        Object.assign(data, trigger);
      }
      outputs.set(node.id, data);
      step.output = result.output;
      step.exitCode = result.exitCode;
      step.durationMs = Date.now() - startedAt;
      step.finishedAt = Date.now();
      step.data = data;
      step.status = result.ok ? "success" : "failed";
      if (!result.ok) failed.add(node.id);
      if (node.type === "condition") {
        branchOf.set(node.id, data.result ? "true" : "false");
      }
    } catch (error) {
      step.status = "failed";
      step.error = error instanceof Error ? error.message : String(error);
      step.output = step.error;
      step.finishedAt = Date.now();
      step.durationMs = Date.now() - startedAt;
      failed.add(node.id);
    }
    await persist("running");

    for (const edge of edges.filter((entry) => entry.source === node.id)) {
      const target = nodes.find((candidate) => candidate.id === edge.target);
      if (target && !visited.has(target.id)) queue.push({ node: target, from: node.id });
    }
  }

  const anyFailed = failed.size > 0;
  await persist(anyFailed ? "failed" : "success", anyFailed ? `${failed.size} step(s) failed` : null);
  void workflowName;
}

type WorkflowRunRowStatus = "running" | "success" | "failed" | "cancelled";
