import type { NodeDefinition, StepType } from "./types";

/**
 * Node definition registry. The editor palette, the settings form and the
 * runner all read from here — adding a step type is a single entry.
 */
export const NODE_DEFINITIONS: Record<StepType, NodeDefinition> = {
  trigger: {
    type: "trigger",
    label: "Trigger",
    glyph: "⚡",
    accent: "#a78bfa",
    description: "Entry point. Its output object is available to every downstream step.",
    fields: [
      { key: "container", label: "container", kind: "text", placeholder: "vega-shop-api-1", help: "Shorthand {{container}} resolves to this value" },
      { key: "image", label: "image", kind: "text", placeholder: "ghcr.io/vega/shop-api:2.14.3" },
      { key: "note", label: "note", kind: "text", placeholder: "deploy checkout v2.14.3" },
      { key: "manual", label: "manual run", kind: "boolean", help: "Demo trigger — runs started by hand carry this payload" },
    ],
    outputs: ["container", "image", "note", "manual", "startedAt"],
    defaults: { container: "vega-shop-api-1", image: "ghcr.io/vega/shop-api:2.14.3", manual: true },
  },
  dockerAction: {
    type: "dockerAction",
    label: "Docker action",
    glyph: "◧",
    accent: "#38bdf8",
    description: "Start / stop / restart / pause / kill a container, or act on a compose project.",
    fields: [
      {
        key: "action",
        label: "action",
        kind: "select",
        options: ["start", "stop", "restart", "pause", "unpause", "kill"].map((value) => ({ value, label: value })),
        required: true,
      },
      { key: "target", label: "container", kind: "text", placeholder: "{{container}}", required: true },
    ],
    outputs: ["message", "action", "target"],
    defaults: { action: "restart", target: "{{container}}" },
  },
  dockerRun: {
    type: "dockerRun",
    label: "Docker run",
    glyph: "▤",
    accent: "#22d3ee",
    description: "Create and start a container from an image.",
    fields: [
      { key: "image", label: "image", kind: "text", placeholder: "nginx:1.27-alpine", required: true },
      { key: "name", label: "name", kind: "text", placeholder: "wf-nginx" },
      { key: "ports", label: "ports", kind: "text", placeholder: "8080:80, 8443:443", help: "comma separated host:container" },
      { key: "env", label: "env", kind: "textarea", placeholder: "KEY=value\nOTHER=value" },
      { key: "command", label: "command", kind: "text", placeholder: "sh -lc 'echo hello'" },
    ],
    outputs: ["id", "name"],
    defaults: { image: "nginx:1.27-alpine", name: "wf-nginx", ports: "8099:80" },
  },
  dockerExec: {
    type: "dockerExec",
    label: "Docker exec",
    glyph: "⌘",
    accent: "#34d399",
    description: "Runs /bin/sh -lc <command> inside a container; non-zero exit fails the step.",
    fields: [
      { key: "container", label: "container", kind: "text", placeholder: "{{container}}", required: true },
      { key: "command", label: "command", kind: "textarea", placeholder: "uname -a && cat /etc/os-release", required: true },
    ],
    outputs: ["exitCode", "output", "durationMs"],
    defaults: { container: "{{container}}", command: "uname -a" },
  },
  dockerLogs: {
    type: "dockerLogs",
    label: "Docker logs",
    glyph: "☰",
    accent: "#818cf8",
    description: "Fetch the tail of a container log and assert on its content.",
    fields: [
      { key: "container", label: "container", kind: "text", placeholder: "{{container}}", required: true },
      { key: "tail", label: "tail", kind: "number", placeholder: "200" },
      { key: "require", label: "must contain", kind: "text", placeholder: "ready to accept connections" },
      { key: "forbid", label: "must not contain", kind: "text", placeholder: "OutOfMemory" },
    ],
    outputs: ["lines", "matched", "logs"],
    defaults: { container: "{{container}}", tail: 200 },
  },
  healthcheck: {
    type: "healthcheck",
    label: "Healthcheck",
    glyph: "♥",
    accent: "#fbbf24",
    description: "Poll an HTTP endpoint until it returns the expected status or retries run out.",
    fields: [
      { key: "url", label: "url", kind: "text", placeholder: "http://127.0.0.1:3000/api/health", required: true },
      { key: "expect", label: "expected status", kind: "number", placeholder: "200" },
      { key: "retries", label: "retries", kind: "number", placeholder: "3" },
      { key: "intervalMs", label: "interval (ms)", kind: "number", placeholder: "500" },
      { key: "timeoutMs", label: "timeout (ms)", kind: "number", placeholder: "4000" },
    ],
    outputs: ["status", "ok", "attempts", "body"],
    defaults: { url: "http://127.0.0.1:3000/api/health", expect: 200, retries: 3, intervalMs: 500, timeoutMs: 4000 },
  },
  cli: {
    type: "cli",
    label: "CLI",
    glyph: ">_",
    accent: "#e879f9",
    description: "Spawn a local binary with an argv array (shell disabled, deny-list enforced).",
    fields: [
      { key: "binary", label: "binary", kind: "text", placeholder: "docker", required: true },
      { key: "args", label: "args", kind: "textarea", placeholder: "ps -a --format '{{.Names}}'" },
      { key: "cwd", label: "cwd", kind: "text", placeholder: "/home/user/racmond" },
      { key: "env", label: "env", kind: "textarea", placeholder: "KEY=value" },
      { key: "timeoutMs", label: "timeout (ms)", kind: "number", placeholder: "30000" },
    ],
    outputs: ["exitCode", "stdout", "stderr", "durationMs"],
    defaults: { binary: "node", args: "-v", timeoutMs: 15000 },
  },
  http: {
    type: "http",
    label: "HTTP request",
    glyph: "⇄",
    accent: "#60a5fa",
    description: "Call any API and assert on the status code.",
    fields: [
      { key: "url", label: "url", kind: "text", placeholder: "https://api.github.com/rate_limit", required: true },
      {
        key: "method",
        label: "method",
        kind: "select",
        options: ["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => ({ value, label: value })),
      },
      { key: "headers", label: "headers", kind: "textarea", placeholder: "accept: application/json" },
      { key: "body", label: "body", kind: "textarea", placeholder: "{\"ping\":true}" },
      { key: "expect", label: "expected status", kind: "number", placeholder: "200" },
    ],
    outputs: ["status", "ok", "body"],
    defaults: { url: "https://api.github.com/rate_limit", method: "GET", expect: 200 },
  },
  delay: {
    type: "delay",
    label: "Delay",
    glyph: "◷",
    accent: "#94a3b8",
    description: "Wait before continuing (capped at 30s).",
    fields: [{ key: "ms", label: "duration (ms)", kind: "number", placeholder: "1500" }],
    outputs: ["waitedMs"],
    defaults: { ms: 1500 },
  },
  condition: {
    type: "condition",
    label: "Condition",
    glyph: "?",
    accent: "#fb7185",
    description: "Compares two templated values and takes the true/false branch.",
    fields: [
      { key: "left", label: "left", kind: "text", placeholder: "{{health_1.status}}", required: true },
      {
        key: "operator",
        label: "operator",
        kind: "select",
        options: ["==", "!=", ">", ">=", "<", "<=", "contains", "matches"].map((value) => ({ value, label: value })),
      },
      { key: "right", label: "right", kind: "text", placeholder: "200" },
    ],
    outputs: ["result", "left", "right"],
    defaults: { left: "{{health.status}}", operator: "==", right: "200" },
  },
  notify: {
    type: "notify",
    label: "Notify",
    glyph: "✉",
    accent: "#facc15",
    description: "Write an operator notification into the run timeline.",
    fields: [
      {
        key: "channel",
        label: "channel",
        kind: "select",
        options: ["operator", "slack", "pagerduty", "webhook"].map((value) => ({ value, label: value })),
      },
      { key: "message", label: "message", kind: "textarea", placeholder: "deploy finished for {{container}}", required: true },
    ],
    outputs: ["delivered", "channel", "message"],
    defaults: { channel: "operator", message: "workflow finished for {{container}}" },
  },
};

export const NODE_TYPES = Object.keys(NODE_DEFINITIONS) as StepType[];

export function definitionOf(type: string): NodeDefinition {
  return NODE_DEFINITIONS[type as StepType] ?? NODE_DEFINITIONS.cli;
}

export const DEFAULT_GRAPH = {
  nodes: [
    { id: "trigger-1", type: "trigger", position: { x: 40, y: 200 }, data: { label: "Trigger", config: { ...NODE_DEFINITIONS.trigger.defaults } } },
    {
      id: "health-1",
      type: "healthcheck",
      position: { x: 380, y: 80 },
      data: { label: "Engine health", config: { ...NODE_DEFINITIONS.healthcheck.defaults, url: "http://127.0.0.1:3000/api/health" } },
    },
    {
      id: "logs-1",
      type: "dockerLogs",
      position: { x: 380, y: 280 },
      data: { label: "Triage logs", config: { ...NODE_DEFINITIONS.dockerLogs.defaults, require: "" } },
    },
    {
      id: "exec-1",
      type: "dockerExec",
      position: { x: 720, y: 280 },
      data: { label: "Probe container", config: { ...NODE_DEFINITIONS.dockerExec.defaults, command: "uname -a" } },
    },
    {
      id: "notify-1",
      type: "notify",
      position: { x: 1060, y: 180 },
      data: { label: "Report", config: { ...NODE_DEFINITIONS.notify.defaults } },
    },
  ],
  edges: [
    { id: "e-t-h", source: "trigger-1", target: "health-1" },
    { id: "e-t-l", source: "trigger-1", target: "logs-1" },
    { id: "e-l-e", source: "logs-1", target: "exec-1" },
    { id: "e-h-n", source: "health-1", target: "notify-1" },
    { id: "e-e-n", source: "exec-1", target: "notify-1" },
  ],
};
