import { TtlCache, hashId } from "@/lib/cache";
import { envOrNull } from "@/lib/env";
import { HttpError } from "@/lib/api";
import type { ConfigEdge, ConfigNode, FileNode, Finding, GithubIssue, GithubModel } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

const API = "https://api.github.com";
const cache = new TtlCache<GithubModel>(5 * 60 * 1000);
const MAX_FILE_BYTES = 400 * 1024;

interface GithubResponse<T> {
  data: T;
  rate: { limit: number; remaining: number; reset: string } | null;
}

function rateFrom(headers: Headers): { limit: number; remaining: number; reset: string } | null {
  const limit = headers.get("x-ratelimit-limit");
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (!limit || !remaining || !reset) return null;
  return {
    limit: Number(limit),
    remaining: Number(remaining),
    reset: new Date(Number(reset) * 1000).toISOString(),
  };
}

export function hasToken(): boolean {
  return Boolean(envOrNull("GITHUB_TOKEN") ?? envOrNull("GH_TOKEN"));
}

async function request<T>(path: string): Promise<GithubResponse<T>> {
  const token = envOrNull("GITHUB_TOKEN") ?? envOrNull("GH_TOKEN");
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "dockflow-config-inspector",
    "x-github-api-version": "2022-11-28",
  };
  if (token) headers.authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { headers, cache: "no-store", signal: AbortSignal.timeout(8000) });
  } catch (error) {
    throw new HttpError(503, `GitHub could not be reached: ${error instanceof Error ? error.message : String(error)}`);
  }
  const rate = rateFrom(response.headers);
  if (response.status === 404) throw new HttpError(404, `GitHub returned 404 for ${path} — repo missing or private without a token.`);
  if (response.status === 403 || response.status === 429) {
    throw new HttpError(429, `GitHub rate limit hit (${rate?.remaining ?? 0}/${rate?.limit ?? "?"} left, resets ${rate?.reset ?? "soon"}).${token ? "" : " Set GITHUB_TOKEN to raise the quota."}`);
  }
  if (!response.ok) throw new HttpError(response.status, `GitHub request failed: ${response.status} ${response.statusText}`);

  const data = (await response.json().catch(() => null)) as T;
  return { data, rate };
}

function normaliseRepo(input: string): string {
  const trimmed = input.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length < 2) throw new HttpError(400, "repository must look like owner/name");
  return `${parts[0]}/${parts[1]}`;
}

/* ------------------------------------------------------------- issue graph */

const REFERENCE_PATTERN = /(close[sd]?|fix(e[sd])?|resolve[sd]?|block(s|ed|ing)?)\s+#(\d+)|(?<![\w/&])#(\d+)/gi;

function referencesIn(body: string, selfNumber: number): { number: number; verb: string }[] {
  const found: { number: number; verb: string }[] = [];
  for (const match of body.matchAll(REFERENCE_PATTERN)) {
    const number = Number(match[4] ?? match[5]);
    if (!Number.isFinite(number) || number === selfNumber) continue;
    const verb = match[1] ? match[1].toLowerCase().replace(/s$/, "") : "references";
    found.push({ number, verb });
  }
  return found;
}

export function buildIssueGraph(repo: string, issues: GithubIssue[]): { nodes: ConfigNode[]; edges: ConfigEdge[] } {
  const nodes: ConfigNode[] = [];
  const edges: ConfigEdge[] = [];
  const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const rootId = `gh:${repo}`;
  const open = issues.filter((issue) => issue.state === "open");
  const closed = issues.filter((issue) => issue.state === "closed");

  nodes.push({
    id: rootId,
    parentId: null,
    title: repo,
    subtitle: `${issues.length} issues · ${open.length} open`,
    kind: "repository",
    chips: [`${open.length} open`, `${closed.length} closed`, `${issues.filter((issue) => issue.pullRequest).length} PRs`],
  });
  nodes.push({
    id: "gh:open",
    parentId: rootId,
    title: "open",
    subtitle: `${open.length} issues`,
    kind: "issue-state",
    chips: [`${open.length}`],
  });
  nodes.push({
    id: "gh:closed",
    parentId: rootId,
    title: "closed",
    subtitle: `${closed.length} issues`,
    kind: "issue-state",
    chips: [`${closed.length}`],
  });

  for (const issue of issues) {
    const id = `gh:issue:${issue.number}`;
    const references = referencesIn(issue.body, issue.number);
    nodes.push({
      id,
      parentId: issue.state === "open" ? "gh:open" : "gh:closed",
      title: `#${issue.number} ${issue.title}`.slice(0, 70),
      subtitle: `${issue.state} · ${issue.assignees.join(", ") || "unassigned"}${issue.pullRequest ? " · PR" : ""}`,
      kind: issue.pullRequest ? "pull-request" : "issue",
      chips: issue.labels.slice(0, 4),
    });
    for (const reference of references) {
      if (!byNumber.has(reference.number)) continue;
      edges.push({ source: id, target: `gh:issue:${reference.number}`, label: reference.verb });
    }
  }

  // dangling references are surfaced separately; dedupe edges
  const seen = new Set<string>();
  return {
    nodes,
    edges: edges.filter((edge) => {
      const key = `${edge.source}→${edge.target}→${edge.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

function insightsOf(repo: string, issues: GithubIssue[]): Finding[] {
  const findings: Finding[] = [];
  const now = Date.now();
  const open = issues.filter((issue) => issue.state === "open");
  const blocked = new Set<string>();
  for (const issue of issues) {
    for (const reference of referencesIn(issue.body, issue.number)) {
      if (reference.verb === "block") blocked.add(`#${reference.number}`);
    }
  }

  const stale = open.filter((issue) => now - new Date(issue.updatedAt).getTime() > 60 * 24 * 3600 * 1000);
  if (stale.length) {
    findings.push({
      id: "stale",
      severity: "warning",
      code: "stale-issues",
      message: `${stale.length} open issue${stale.length === 1 ? "" : "s"} untouched for more than 60 days (${stale.slice(0, 5).map((issue) => `#${issue.number}`).join(", ")}).`,
    });
  }
  const urgent = open.filter((issue) => issue.labels.some((label) => /bug|critical|p0|security/i.test(label)) && !issue.assignees.length);
  for (const issue of urgent.slice(0, 6)) {
    findings.push({
      id: `unassigned-${issue.number}`,
      severity: "error",
      code: "urgent-unassigned",
      message: `#${issue.number} is labelled ${issue.labels.join("/")} but has no assignee.`,
      target: `gh:issue:${issue.number}`,
    });
  }
  const dangling = issues.flatMap((issue) =>
    referencesIn(issue.body, issue.number)
      .filter((reference) => !issues.some((candidate) => candidate.number === reference.number))
      .map((reference) => ({ issue, reference })),
  );
  for (const { issue, reference } of dangling.slice(0, 6)) {
    findings.push({
      id: `dangling-${issue.number}-${reference.number}`,
      severity: "info",
      code: "dangling-reference",
      message: `#${issue.number} ${reference.verb} #${reference.number}, but that issue is not in the fetched set (try a closer).`,
      target: `gh:issue:${issue.number}`,
    });
  }
  const unlabeled = open.filter((issue) => !issue.labels.length);
  if (unlabeled.length) {
    findings.push({
      id: "unlabeled",
      severity: "info",
      code: "unlabeled-issues",
      message: `${unlabeled.length} open issue${unlabeled.length === 1 ? "" : "s"} carry no labels.`,
    });
  }
  if (blocked.size) {
    findings.push({ id: "blocked", severity: "warning", code: "blocked-chain", message: `${blocked.size} issue(s) are referenced as blockers: ${Array.from(blocked).join(", ")}` });
  }
  const prs = issues.filter((issue) => issue.pullRequest && issue.state === "open");
  if (prs.length) {
    findings.push({
      id: "open-prs",
      severity: "info",
      code: "open-pull-requests",
      message: `${prs.length} open pull request${prs.length === 1 ? "" : "s"} appear in the issue feed.`,
    });
  }
  const noMilestone = open.filter((issue) => !issue.milestone);
  if (open.length && noMilestone.length / open.length > 0.7) {
    findings.push({
      id: "no-milestones",
      severity: "info",
      code: "milestone-coverage",
      message: `${Math.round((noMilestone.length / open.length) * 100)}% of open issues have no milestone.`,
    });
  }
  if (!findings.length) {
    findings.push({ id: "healthy", severity: "info", code: "healthy", message: `${repo} issue hygiene looks clean.` });
  }
  return findings;
}

function rollupsOf(issues: GithubIssue[]): GithubModel["rollups"] {
  const tally = (key: (issue: GithubIssue) => string[]) => {
    const map = new Map<string, { open: number; closed: number }>();
    for (const issue of issues) {
      for (const name of key(issue)) {
        const entry = map.get(name) ?? { open: 0, closed: 0 };
        if (issue.state === "open") entry.open += 1;
        else entry.closed += 1;
        map.set(name, entry);
      }
    }
    return map;
  };

  const labels = tally((issue) => issue.labels);
  const milestones = tally((issue) => (issue.milestone ? [issue.milestone] : []));
  const assignees = tally((issue) => issue.assignees);
  const max = Math.max(1, ...Array.from(assignees.values()).map((entry) => entry.open));
  return {
    labels: Array.from(labels.entries())
      .map(([name, counts]) => ({ name, ...counts }))
      .sort((a, b) => b.open + b.closed - (a.open + a.closed))
      .slice(0, 12),
    milestones: Array.from(milestones.entries())
      .map(([name, counts]) => ({ name, ...counts }))
      .sort((a, b) => b.open + b.closed - (a.open + a.closed)),
    assignees: Array.from(assignees.entries())
      .map(([login, counts]) => ({ login, ...counts, load: Math.round((counts.open / max) * 100) }))
      .sort((a, b) => b.open - a.open)
      .slice(0, 12),
  };
}

/* ------------------------------------------------------------------ live */

interface RawIssue {
  number: number;
  title: string;
  state: string;
  body?: string | null;
  labels?: { name?: string }[];
  assignees?: { login?: string }[];
  milestone?: { title?: string } | null;
  created_at: string;
  updated_at: string;
  comments: number;
  pull_request?: unknown;
  html_url: string;
}

export async function fetchGithubModel(input: string): Promise<GithubModel> {
  const repo = normaliseRepo(input);
  const cached = cache.get(repo);
  if (cached) return cached;

  const [repoRes, langRes, contribRes, activityRes, commitsRes, issuesRes] = await Promise.all([
    request<any>(`/repos/${repo}`),
    request<Record<string, number>>(`/repos/${repo}/languages`).catch(() => ({ data: {} as Record<string, number>, rate: null })),
    request<any[]>(`/repos/${repo}/contributors?per_page=20`).catch(() => ({ data: [] as any[], rate: null })),
    request<any[]>(`/repos/${repo}/stats/commit_activity`).catch(() => ({ data: [] as any[], rate: null })),
    request<any[]>(`/repos/${repo}/commits?per_page=12`).catch(() => ({ data: [] as any[], rate: null })),
    request<RawIssue[]>(`/repos/${repo}/issues?state=all&per_page=100&sort=updated`),
  ]);

  const raw = repoRes.data ?? {};
  const totalBytes = Object.values(langRes.data ?? {}).reduce((sum, value) => sum + Number(value), 0) || 1;
  const issues: GithubIssue[] = (issuesRes.data ?? []).map((entry) => ({
    number: entry.number,
    title: entry.title,
    state: entry.state === "closed" ? "closed" : "open",
    body: entry.body ?? "",
    labels: (entry.labels ?? []).map((label) => (typeof label === "string" ? label : String(label?.name ?? ""))).filter(Boolean),
    assignees: (entry.assignees ?? []).map((person) => String(person?.login ?? "")).filter(Boolean),
    milestone: entry.milestone?.title ?? null,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    comments: entry.comments ?? 0,
    pullRequest: Boolean(entry.pull_request),
    htmlUrl: entry.html_url,
  }));

  const graph = buildIssueGraph(repo, issues);
  const model: GithubModel = {
    kind: "github",
    repo,
    source: "live",
    error: null,
    rate: issuesRes.rate ?? repoRes.rate,
    overview: {
      fullName: String(raw.full_name ?? repo),
      description: String(raw.description ?? ""),
      stars: Number(raw.stargazers_count ?? 0),
      forks: Number(raw.forks_count ?? 0),
      watchers: Number(raw.subscribers_count ?? raw.watchers_count ?? 0),
      sizeKb: Number(raw.size ?? 0),
      license: String(raw.license?.spdx_id ?? raw.license?.name ?? "none"),
      topics: Array.isArray(raw.topics) ? raw.topics.map(String) : [],
      pushedAt: String(raw.pushed_at ?? ""),
      defaultBranch: String(raw.default_branch ?? "main"),
      archived: Boolean(raw.archived),
      openIssues: Number(raw.open_issues_count ?? 0),
    },
    languages: Object.entries(langRes.data ?? {})
      .map(([name, bytes]) => ({ name, bytes: Number(bytes), pct: Math.round((Number(bytes) / totalBytes) * 1000) / 10 }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 8),
    contributors: (contribRes.data ?? []).slice(0, 12).map((person) => ({
      login: String(person?.login ?? "unknown"),
      contributions: Number(person?.contributions ?? 0),
      avatar: String(person?.avatar_url ?? ""),
    })),
    commitActivity: Array.isArray(activityRes.data)
      ? activityRes.data.slice(-12).map((week) => ({
          week: Number(week?.week ?? 0),
          total: Number(week?.total ?? 0),
          days: Array.isArray(week?.days) ? week.days.map(Number) : [],
        }))
      : [],
    commits: (commitsRes.data ?? []).slice(0, 8).map((commit) => ({
      sha: String(commit?.sha ?? "").slice(0, 7),
      message: String(commit?.commit?.message ?? "").split("\n")[0].slice(0, 110),
      author: String(commit?.commit?.author?.name ?? commit?.author?.login ?? "unknown"),
      date: String(commit?.commit?.author?.date ?? ""),
    })),
    issues,
    nodes: graph.nodes,
    edges: graph.edges,
    rollups: rollupsOf(issues),
    insights: insightsOf(repo, issues),
    counts: {
      issues: issues.length,
      open: issues.filter((issue) => issue.state === "open").length,
      closed: issues.filter((issue) => issue.state === "closed").length,
      labels: new Set(issues.flatMap((issue) => issue.labels)).size,
      contributors: (contribRes.data ?? []).length,
    },
  };

  cache.set(repo, model);
  return model;
}

/** Cache clears for the manual refresh affordance. */
export function clearGithubCache(): void {
  cache.clear();
}

/* --------------------------------------------------------------- fixture */

const FIXTURE_ISSUES: Omit<GithubIssue, "htmlUrl">[] = [
  {
    number: 412,
    title: "Checkout latency above SLO after 14:20 UTC deploy",
    state: "open",
    body: "p99 went 240ms → 1.4s. Suspect connection pool exhaustion in orders-api. Blocks #418. Related to #401.",
    labels: ["bug", "critical", "performance"],
    assignees: ["syukri"],
    milestone: "2026-Q4 hardening",
    createdAt: "2026-10-08T14:32:00Z",
    updatedAt: "2026-10-21T09:12:00Z",
    comments: 12,
    pullRequest: false,
  },
  {
    number: 418,
    title: "Pool size not applied from env in orders-api",
    state: "open",
    body: "DATABASE_POOL_SIZE is read with ?? so an empty value keeps the default 2. Fixes #412 once merged.",
    labels: ["bug", "config"],
    assignees: ["dwi"],
    milestone: "2026-Q4 hardening",
    createdAt: "2026-10-09T07:05:00Z",
    updatedAt: "2026-10-20T16:48:00Z",
    comments: 4,
    pullRequest: false,
  },
  {
    number: 401,
    title: "Add APM ingest endpoint rate limiting",
    state: "open",
    body: "Ingest accepts 2000 spans per batch with no quota. See #412 and closes #388.",
    labels: ["enhancement", "observability"],
    assignees: ["syukri", "dwi"],
    milestone: null,
    createdAt: "2026-09-28T11:00:00Z",
    updatedAt: "2026-10-19T11:00:00Z",
    comments: 2,
    pullRequest: false,
  },
  {
    number: 388,
    title: "Span retention should prune on a schedule",
    state: "closed",
    body: "Done in #401 — spans now pruned past 20 minutes.",
    labels: ["observability"],
    assignees: ["dwi"],
    milestone: "2026-Q3",
    createdAt: "2026-08-12T09:20:00Z",
    updatedAt: "2026-09-30T10:00:00Z",
    comments: 6,
    pullRequest: false,
  },
  {
    number: 430,
    title: "Document the demo engine fallback",
    state: "open",
    body: "Operators keep asking why the map is labelled DEMO. Explain the probe and the preserved error. Mention #412.",
    labels: ["docs"],
    assignees: [],
    milestone: null,
    createdAt: "2026-10-15T13:40:00Z",
    updatedAt: "2026-10-15T13:40:00Z",
    comments: 0,
    pullRequest: false,
  },
  {
    number: 434,
    title: "feat: workflow runner cancel flag",
    state: "open",
    body: "Adds cancelRequested polling between steps. Closes #420.",
    labels: ["enhancement", "workflows"],
    assignees: ["syukri"],
    milestone: null,
    createdAt: "2026-10-18T08:15:00Z",
    updatedAt: "2026-10-21T07:02:00Z",
    comments: 1,
    pullRequest: true,
  },
  {
    number: 420,
    title: "Cancelling a workflow run leaves steps pending",
    state: "open",
    body: "Expected the run to stop between steps and mark remaining as skipped. Blocked by #434.",
    labels: ["bug", "workflows"],
    assignees: [],
    milestone: "2026-Q4 hardening",
    createdAt: "2026-10-02T15:25:00Z",
    updatedAt: "2026-10-18T08:00:00Z",
    comments: 3,
    pullRequest: false,
  },
  {
    number: 395,
    title: "Compose validator misses duplicate host ports",
    state: "closed",
    body: "Fixed: duplicates now reported as errors.",
    labels: ["bug", "config"],
    assignees: ["dwi"],
    milestone: "2026-Q3",
    createdAt: "2026-08-30T10:10:00Z",
    updatedAt: "2026-09-12T10:10:00Z",
    comments: 2,
    pullRequest: false,
  },
  {
    number: 359,
    title: "Thread dump viewer should highlight deadlocks",
    state: "open",
    body: "JVM tab shows the dump but deadlock cycles are not marked. See #412 for the latency link.",
    labels: ["enhancement", "jvm"],
    assignees: ["syukri"],
    milestone: null,
    createdAt: "2026-07-19T12:00:00Z",
    updatedAt: "2026-09-01T12:00:00Z",
    comments: 5,
    pullRequest: false,
  },
  {
    number: 371,
    title: "CLI runner should refuse shell metacharacters",
    state: "closed",
    body: "shell:false plus a deny-list. Closes #360.",
    labels: ["security"],
    assignees: ["syukri"],
    milestone: "2026-Q3",
    createdAt: "2026-07-30T09:30:00Z",
    updatedAt: "2026-08-14T09:30:00Z",
    comments: 1,
    pullRequest: false,
  },
  {
    number: 360,
    title: "Command injection surface in ad-hoc runner",
    state: "closed",
    body: "Reported via security@. Resolved by #371.",
    labels: ["security", "critical"],
    assignees: ["syukri"],
    milestone: "2026-Q3",
    createdAt: "2026-07-24T07:45:00Z",
    updatedAt: "2026-08-14T09:31:00Z",
    comments: 9,
    pullRequest: false,
  },
  {
    number: 445,
    title: "Config page: Terraform graph renders too wide",
    state: "open",
    body: "The reference graph has no wrapping for wide modules. References #395.",
    labels: ["enhancement", "config"],
    assignees: [],
    milestone: null,
    createdAt: "2026-10-20T10:00:00Z",
    updatedAt: "2026-10-20T10:00:00Z",
    comments: 0,
    pullRequest: false,
  },
];

export function fixtureGithubModel(input: string, reason: string | null = null): GithubModel {
  const repo = (() => {
    try {
      return normaliseRepo(input);
    } catch {
      return "vega-labs/dockflow";
    }
  })();
  const issues: GithubIssue[] = FIXTURE_ISSUES.map((issue) => ({ ...issue, htmlUrl: `https://github.com/${repo}/issues/${issue.number}` }));
  const graph = buildIssueGraph(repo, issues);
  const weeks = Array.from({ length: 12 }, (_, index) => {
    const total = [18, 24, 12, 30, 22, 9, 27, 34, 16, 21, 38, 26][index];
    const days = [0, 0, 0, 0, 0, 0, 0].map((_, day) => Math.max(0, Math.round(total / 7) + ((index + day) % 3) - 1));
    return { week: Math.floor(Date.parse("2026-08-03T00:00:00Z") / 1000) + index * 604800, total, days };
  });

  const model: GithubModel = {
    kind: "github",
    repo,
    source: "fixture",
    error: reason,
    rate: { limit: 60, remaining: 0, reset: new Date(Date.now() + 900_000).toISOString() },
    overview: {
      fullName: repo,
      description: "Local-first observability console for Docker, APM and JVM workloads (offline fixture).",
      stars: 1284,
      forks: 96,
      watchers: 42,
      sizeKb: 8420,
      license: "MIT",
      topics: ["docker", "observability", "apm", "jvm", "nextjs"],
      pushedAt: "2026-10-21T08:41:00Z",
      defaultBranch: "main",
      archived: false,
      openIssues: issues.filter((issue) => issue.state === "open").length,
    },
    languages: [
      { name: "TypeScript", bytes: 486_000, pct: 62.4 },
      { name: "CSS", bytes: 148_000, pct: 19 },
      { name: "JavaScript", bytes: 96_000, pct: 12.3 },
      { name: "Shell", bytes: 49_000, pct: 6.3 },
    ],
    contributors: [
      { login: "syukri", contributions: 412, avatar: "" },
      { login: "dwi", contributions: 268, avatar: "" },
      { login: "aretha", contributions: 97, avatar: "" },
      { login: "bot-dependabot", contributions: 61, avatar: "" },
    ],
    commitActivity: weeks,
    commits: [
      { sha: "9f4c2d1", message: "jvm: highlight deadlock cycles in thread dumps", author: "syukri", date: "2026-10-21T08:41:00Z" },
      { sha: "42ae77b", message: "apm: synthetic traffic toggle is now labelled", author: "dwi", date: "2026-10-20T15:02:00Z" },
      { sha: "c1093e8", message: "config: allow-list scan roots", author: "syukri", date: "2026-10-19T11:26:00Z" },
      { sha: "7b30ffa", message: "workflows: persist step transitions", author: "aretha", date: "2026-10-18T09:14:00Z" },
      { sha: "1e6c0d5", message: "docker: circuit-break the version probe", author: "dwi", date: "2026-10-17T18:40:00Z" },
    ],
    issues,
    nodes: graph.nodes,
    edges: graph.edges,
    rollups: rollupsOf(issues),
    insights: insightsOf(repo, issues),
    counts: {
      issues: issues.length,
      open: issues.filter((issue) => issue.state === "open").length,
      closed: issues.filter((issue) => issue.state === "closed").length,
      labels: new Set(issues.flatMap((issue) => issue.labels)).size,
      contributors: 4,
    },
  };
  return model;
}

/* ------------------------------------------------------- contents / tree */

export async function listDirectory(repo: string, path: string, ref: string): Promise<FileNode[]> {
  const clean = path.replace(/^\/+|\/+$/g, "");
  const query = `?ref=${encodeURIComponent(ref || "main")}`;
  const { data } = await request<any[]>(`/repos/${normaliseRepo(repo)}/contents/${clean}${query}`);
  if (!Array.isArray(data)) throw new HttpError(400, `${path || "/"} is a file, not a directory`);
  return data.map((entry) => ({
    path: String(entry.path ?? ""),
    name: String(entry.name ?? ""),
    type: entry.type === "dir" ? "dir" : "file",
    size: entry.type === "dir" ? null : Number(entry.size ?? 0),
    sha: entry.sha ? String(entry.sha) : null,
    loaded: entry.type !== "dir",
  }));
}

export async function readFilePreview(
  repo: string,
  path: string,
  ref: string,
): Promise<{ path: string; size: number; truncated: boolean; binary: boolean; content: string }> {
  const clean = path.replace(/^\/+/, "");
  const query = `?ref=${encodeURIComponent(ref || "main")}`;
  const { data } = await request<any>(`/repos/${normaliseRepo(repo)}/contents/${clean}${query}`);
  const size = Number(data?.size ?? 0);
  if (size > MAX_FILE_BYTES) throw new HttpError(413, `${clean} is ${(size / 1024).toFixed(0)} KB — over the 400 KB preview limit.`);
  const encoding = String(data?.encoding ?? "");
  if (encoding !== "base64" || !data?.content) throw new HttpError(415, `${clean} is not text (GitHub returned ${encoding || "no"} encoding).`);
  const buffer = Buffer.from(String(data.content), "base64");
  const binary = buffer.includes(0);
  return {
    path: clean,
    size,
    truncated: false,
    binary,
    content: binary ? "" : buffer.toString("utf8").slice(0, MAX_FILE_BYTES),
  };
}

export function fileRefPath(repo: string, path: string): string {
  return `github://${repo}/${path.replace(/^\/+/, "")}`;
}

/** stable colour-free id for cached objects (used by routes that key by target) */
export function cacheKeyOf(repo: string): string {
  return hashId(`github:${repo}`);
}

/* --------------------------------------------------- fixture file browser */

const FIXTURE_FILES: Record<string, string> = {
  "README.md": `# dockflow\n\nLocal-first console for Docker estates, APM, workflows and JVM diagnostics.\n\n- \`/containers\` inventory with live actions\n- \`/graph\` hierarchical topology (host → project → service → container)\n- \`/apm\` service map, trace waterfall and Apdex vs SLA\n- \`/workflows\` automation builder\n- \`/jvm\` monitor, GC, threads, sampler, MBeans, dumps, anatomy\n- \`/config\` compose validator, Terraform graph, GitHub review\n- \`/cli\` ad-hoc command runner\n`,
  "package.json": `{\n  "name": "dockflow",\n  "private": true,\n  "scripts": {\n    "dev": "next dev",\n    "build": "next build",\n    "typecheck": "tsc --noEmit"\n  },\n  "dependencies": {\n    "@xyflow/react": "^12.12.0",\n    "dockerode": "^5.0.1",\n    "drizzle-orm": "1.0.0-rc.4",\n    "next": "^16.4.2",\n    "react": "19.2.6"\n  }\n}\n`,
  "docker-compose.yml": `name: vega-shop\nservices:\n  gateway:\n    image: nginx:1.27-alpine\n    ports: ["8080:80"]\n    depends_on:\n      api:\n        condition: service_healthy\n  api:\n    build: .\n    environment:\n      DATABASE_URL: postgres://vega:supersecret@postgres:5432/shop\n    healthcheck:\n      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]\n`,
  "src/lib/apm.ts": `export const APM_WINDOW_SECONDS = 600;\nexport const APM_SPAN_RETENTION_SECONDS = 1200;\nexport const APM_EDGE_WINDOW_SECONDS = 3600;\n\nexport function apmMap() {\n  // services ← live containers ⊕ apm_services ⊕ telemetry-only agents\n}\n`,
  "src/app/page.tsx": `export default function Page() {\n  return <main>engine at a glance</main>;\n}\n`,
  "src/components/map/MapCanvas.tsx": `export function MapCanvas() {\n  // one shared hierarchy canvas\n}\n`,
  "infra/terraform/main.tf": `resource "aws_instance" "web" {\n  ami           = data.aws_ami.ubuntu.id\n  instance_type = var.instance_type\n}\n`,
  "infra/terraform/variables.tf": `variable "instance_type" {\n  type    = string\n  default = "t3.small"\n}\n`,
  "docs/architecture.md": `# Architecture\n\nThe demo engine keeps its state on \`globalThis\` so a dev-server reload does not\nreset the seeded estate. Every graph is an @xyflow/react canvas with parent/child\nhierarchy and expand/collapse.\n`,
  "docs/runbook.md": `# Runbook\n\n1. start the console\n2. check /api/health\n3. open the topology\n`,
  "tests/apm.test.ts": `describe("apm", () => {\n  it("computes apdex", () => {});\n});\n`,
};

export function fixtureListDirectory(path: string): FileNode[] {
  const prefix = path.replace(/^\/+|\/+$/g, "");
  const entries = new Map<string, FileNode>();
  for (const [file, content] of Object.entries(FIXTURE_FILES)) {
    if (prefix && !file.startsWith(`${prefix}/`)) continue;
    const rest = prefix ? file.slice(prefix.length + 1) : file;
    const [head, ...tail] = rest.split("/");
    const entryPath = prefix ? `${prefix}/${head}` : head;
    if (tail.length) {
      entries.set(entryPath, { path: entryPath, name: head, type: "dir", size: null, sha: null, loaded: false });
    } else {
      entries.set(entryPath, { path: entryPath, name: head, type: "file", size: Buffer.byteLength(content), sha: hashId(entryPath), loaded: true });
    }
  }
  if (!entries.size) throw new HttpError(404, `${path || "/"} does not exist in the offline fixture`);
  return Array.from(entries.values()).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
}

export function fixtureReadFile(path: string): { path: string; size: number; truncated: boolean; binary: boolean; content: string } {
  const clean = path.replace(/^\/+/, "");
  const content = FIXTURE_FILES[clean];
  if (content === undefined) throw new HttpError(404, `${clean} does not exist in the offline fixture`);
  const size = Buffer.byteLength(content);
  if (size > MAX_FILE_BYTES) throw new HttpError(413, `${clean} is over the 400 KB preview limit`);
  return { path: clean, size, truncated: false, binary: false, content };
}
