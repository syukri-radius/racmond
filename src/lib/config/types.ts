export interface ConfigNode {
  id: string;
  parentId: string | null;
  title: string;
  subtitle: string;
  kind: string;
  chips: string[];
}

export interface ConfigEdge {
  source: string;
  target: string;
  label?: string;
}

export interface Finding {
  id: string;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  target?: string;
}

export interface ServiceRow {
  name: string;
  image: string;
  ports: string;
  dependsOn: string;
  networks: string;
  volumes: string;
  env: string;
  healthcheck: string;
  profiles: string;
}

export interface ComposeModel {
  kind: "compose";
  project: string;
  version: string | null;
  nodes: ConfigNode[];
  edges: ConfigEdge[];
  services: ServiceRow[];
  findings: Finding[];
  profiles: string[];
  counts: { services: number; ports: number; volumes: number; networks: number; secrets: number };
}

export interface TerraformModel {
  kind: "terraform";
  directory: string;
  files: string[];
  nodes: ConfigNode[];
  edges: ConfigEdge[];
  findings: Finding[];
  inventory: {
    resources: { address: string; type: string; name: string; file: string; references: string[] }[];
    variables: { name: string; type: string; default: string; sensitive: boolean; used: boolean; file: string }[];
    outputs: { name: string; value: string; file: string }[];
    providers: { name: string; alias: string | null; file: string }[];
    modules: { name: string; source: string; file: string }[];
  };
  counts: { resources: number; data: number; variables: number; outputs: number; modules: number; providers: number };
}

export interface GithubIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  body: string;
  labels: string[];
  assignees: string[];
  milestone: string | null;
  createdAt: string;
  updatedAt: string;
  comments: number;
  pullRequest: boolean;
  htmlUrl: string;
}

export interface GithubModel {
  kind: "github";
  repo: string;
  source: "live" | "fixture";
  error: string | null;
  rate: { limit: number; remaining: number; reset: string } | null;
  overview: {
    fullName: string;
    description: string;
    stars: number;
    forks: number;
    watchers: number;
    sizeKb: number;
    license: string;
    topics: string[];
    pushedAt: string;
    defaultBranch: string;
    archived: boolean;
    openIssues: number;
  };
  languages: { name: string; bytes: number; pct: number }[];
  contributors: { login: string; contributions: number; avatar: string }[];
  commitActivity: { week: number; total: number; days: number[] }[];
  commits: { sha: string; message: string; author: string; date: string }[];
  issues: GithubIssue[];
  nodes: ConfigNode[];
  edges: ConfigEdge[];
  rollups: {
    labels: { name: string; open: number; closed: number }[];
    milestones: { name: string; open: number; closed: number }[];
    assignees: { login: string; open: number; closed: number; load: number }[];
  };
  insights: Finding[];
  counts: { issues: number; open: number; closed: number; labels: number; contributors: number };
}

export interface FileNode {
  path: string;
  name: string;
  type: "file" | "dir";
  size: number | null;
  sha: string | null;
  loaded: boolean;
}

export type ConfigSourceKind = "compose" | "terraform" | "github" | "dockerfile" | "workspace";

export interface ConfigSourceRow {
  id: string;
  name: string;
  kind: ConfigSourceKind;
  target: string;
  status: string;
  lastError: string | null;
  lastLoadedAt: number | null;
  summary: Record<string, unknown> | null;
}
