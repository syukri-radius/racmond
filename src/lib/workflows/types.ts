export type StepType =
  | "trigger"
  | "dockerAction"
  | "dockerRun"
  | "dockerExec"
  | "dockerLogs"
  | "healthcheck"
  | "cli"
  | "http"
  | "delay"
  | "condition"
  | "notify";

export type FieldKind = "text" | "number" | "select" | "textarea" | "boolean";

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
}

export interface NodeDefinition {
  type: StepType;
  label: string;
  glyph: string;
  accent: string;
  description: string;
  fields: FieldDef[];
  outputs: string[];
  defaults?: Record<string, unknown>;
}

export interface WorkflowGraphNode {
  id: string;
  type: StepType;
  position: { x: number; y: number };
  data: { label?: string; config: Record<string, unknown> };
}

export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export type StepStatus = "pending" | "running" | "success" | "failed" | "skipped" | "cancelled";

export interface WorkflowStep {
  nodeId: string;
  type: StepType;
  label: string;
  status: StepStatus;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number;
  output: string;
  exitCode: number | null;
  error: string | null;
  data?: Record<string, unknown>;
}

export interface WorkflowRunRow {
  id: string;
  workflowId: string;
  workflowName: string | null;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  trigger: Record<string, unknown> | null;
  steps: WorkflowStep[];
  error: string | null;
  cancelRequested: boolean;
  startedAt: Date;
  finishedAt: Date | null;
}
