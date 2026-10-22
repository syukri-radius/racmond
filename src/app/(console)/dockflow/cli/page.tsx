"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { deleteJson, formatMs, patchJson, postJson, usePoll } from "@/lib/client";
import type { BinaryInfo, RunResult } from "@/lib/cli";
import { Button, Chip, ErrorNote, Field, Modal, Notice, PageHeader, Panel, Select, Table, Td, TextArea, TextInput, Th, type Tone } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";

interface CliTool {
  id: string;
  name: string;
  binary: string;
  baseArgs: string;
  category: string;
  cwd: string | null;
  env: Record<string, string> | null;
  favourite: boolean;
}

interface RunEntry {
  at: number;
  binary: string;
  args: string;
  result: RunResult;
}

export default function CliPage() {
  const tools = usePoll<{ tools: CliTool[] }>("/api/cli/tools", 0);
  const binaries = usePoll<{ binaries: BinaryInfo[] }>("/api/cli/detect?limit=20", 0);

  const [binary, setBinary] = useState("docker");
  const [args, setArgs] = useState("ps -a --format \"table {{.Names}}\\t{{.Status}}\\t{{.Ports}}\"");
  const [cwd, setCwd] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(30_000);
  const [env, setEnv] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<RunEntry[]>([]);
  const [toolOpen, setToolOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: Tone; message: string } | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, CliTool[]>();
    for (const tool of tools.data?.tools ?? []) map.set(tool.category, [...(map.get(tool.category) ?? []), tool]);
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [tools.data]);

  const run = async (tool?: CliTool) => {
    setRunning(true);
    setError(null);
    try {
      const payload = await postJson<{ result: RunResult }>("/api/cli/run", {
        binary: tool ? tool.binary : binary,
        args: tool ? tool.baseArgs : args,
        cwd: cwd || undefined,
        env: env
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .reduce<Record<string, string>>((acc, line) => {
            const index = line.indexOf("=");
            if (index > 0) acc[line.slice(0, index)] = line.slice(index + 1);
            return acc;
          }, {}),
        timeoutMs,
      });
      setResult(payload.result);
      setHistory((current) => [{ at: Date.now(), binary: tool ? tool.binary : binary, args: tool ? tool.baseArgs : args, result: payload.result }, ...current].slice(0, 20));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  };

  const toggleFavourite = async (tool: CliTool) => {
    try {
      await patchJson("/api/cli/tools", { id: tool.id, favourite: !tool.favourite });
      tools.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const removeTool = async (tool: CliTool) => {
    try {
      await deleteJson(`/api/cli/tools?id=${encodeURIComponent(tool.id)}`);
      tools.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHeader
        eyebrow="cli / local tooling"
        title="Command runner"
        description="Run locally installed binaries with argv arrays only — shell:false, a 30s default timeout (120s max), output byte budget and a deny-list for destructive commands."
        actions={
          <>
            <Button icon="plus" onClick={() => setToolOpen(true)}>
              save preset
            </Button>
            <Button
              icon="refresh"
              onClick={() => {
                tools.refresh();
                binaries.refresh();
              }}
            >
              rescan PATH
            </Button>
          </>
        }
      />

      {error ? <Notice tone="bad">{error}</Notice> : null}
      {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[290px_minmax(0,1fr)_280px]">
        <Panel title="library" subtitle={`${tools.data?.tools.length ?? 0} presets`} icon="stack" padded={false} className="max-h-[calc(100vh-190px)]">
          <div className="scroll-thin h-full max-h-[calc(100vh-190px)] overflow-y-auto p-1.5">
            {grouped.map(([category, list]) => (
              <div key={category} className="mb-2">
                <p className="mb-1 px-1 font-mono text-[8.5px] uppercase tracking-[0.16em] text-slate-500">{category}</p>
                <div className="flex flex-col gap-0.5">
                  {list.map((tool) => (
                    <div
                      key={tool.id}
                      className={cn(
                        "group flex items-center gap-1 rounded border px-1.5 py-1",
                        selectedTool === tool.id ? "border-ice/45 bg-ice/[0.08]" : "border-transparent hover:border-line",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTool(tool.id);
                          setBinary(tool.binary);
                          setArgs(tool.baseArgs);
                          setCwd(tool.cwd ?? "");
                        }}
                        onDoubleClick={() => void run(tool)}
                        className="min-w-0 flex-1 text-left"
                        title={`${tool.binary} ${tool.baseArgs}`}
                      >
                        <p className="truncate font-mono text-[10.5px] text-slate-200">{tool.name}</p>
                        <p className="truncate font-mono text-[8.5px] text-slate-500">
                          {tool.binary} {tool.baseArgs}
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleFavourite(tool)}
                        className={cn("shrink-0 text-[10px]", tool.favourite ? "text-amber-300" : "text-slate-600 hover:text-slate-400")}
                        title={tool.favourite ? "unpin" : "pin"}
                      >
                        ★
                      </button>
                      <button type="button" onClick={() => void run(tool)} className="shrink-0 text-slate-500 hover:text-ice" title="run">
                        <Icon name="play" size={11} />
                      </button>
                      <button type="button" onClick={() => void removeTool(tool)} className="shrink-0 text-slate-600 hover:text-rose-300" title="delete">
                        <Icon name="x" size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!grouped.length ? <p className="py-6 text-center text-[11px] text-slate-500">{tools.loading ? "loading…" : "no presets saved"}</p> : null}
          </div>
        </Panel>

        <div className="flex min-h-0 flex-col gap-3">
          <Panel title="command" subtitle="argv only · no shell interpolation" icon="terminal">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[12px] text-slate-500">$</span>
                <input
                  value={binary}
                  onChange={(event) => setBinary(event.target.value)}
                  className="h-7 w-[150px] rounded-md border border-line bg-ink-900/60 px-2 font-mono text-[11px] text-slate-100 focus:border-ice/60 focus:outline-none"
                  placeholder="binary"
                />
                <input
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void run();
                  }}
                  className="h-7 min-w-0 flex-1 rounded-md border border-line bg-ink-900/60 px-2 font-mono text-[11px] text-slate-100 focus:border-ice/60 focus:outline-none"
                  placeholder="--version"
                />
                <Button variant="primary" icon="play" onClick={() => void run()} disabled={running || !binary.trim()}>
                  {running ? "running" : "run"}
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Field label="cwd" hint="blank = repository root">
                  <TextInput value={cwd} onChange={setCwd} placeholder="/home/user/racmond" />
                </Field>
                <Field label="timeout">
                  <Select
                    value={String(timeoutMs)}
                    onChange={(value) => setTimeoutMs(Number(value))}
                    options={[
                      { value: "5000", label: "5s" },
                      { value: "15000", label: "15s" },
                      { value: "30000", label: "30s (default)" },
                      { value: "60000", label: "60s" },
                      { value: "120000", label: "120s (max)" },
                    ]}
                  />
                </Field>
                <Field label="env" hint="KEY=value per line">
                  <TextInput value={env} onChange={setEnv} placeholder="TZ=UTC" />
                </Field>
              </div>
              {selectedTool ? (
                <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">
                  preset loaded — {tools.data?.tools.find((tool) => tool.id === selectedTool)?.name}
                </p>
              ) : null}
            </div>
          </Panel>

          <Panel
            title="output"
            subtitle={result ? `${result.binary} ${result.argv.slice(1).join(" ")}` : "no run yet"}
            icon="code"
            className="min-h-[280px] flex-1"
            actions={
              result ? (
                <>
                  <Chip tone={result.blocked ? "bad" : result.exitCode === 0 ? "ok" : result.exitCode === 127 ? "warn" : "bad"}>
                    {result.blocked ? "blocked" : `exit ${result.exitCode ?? "signal"}`}
                  </Chip>
                  <Chip tone="muted">{formatMs(result.durationMs)}</Chip>
                  {result.truncated ? <Chip tone="warn">truncated</Chip> : null}
                  {result.timedOut ? <Chip tone="bad">timed out</Chip> : null}
                </>
              ) : null
            }
          >
            <pre className="scroll-thin h-[calc(100%-2px)] max-h-[46vh] min-h-[220px] overflow-auto whitespace-pre-wrap rounded-md border border-line bg-[#06030c] p-2.5 font-mono text-[10.5px] leading-relaxed text-slate-300">
              {result ? result.output || "(no output)" : "$ waiting for a command"}
            </pre>
            {result?.blocked ? <p className="mt-1 font-mono text-[10px] text-rose-300">{result.blocked}</p> : null}
            {result ? (
              <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">
                <span>cwd {result.cwd}</span>
                <span>·</span>
                <span>argv {result.argv.length}</span>
                {result.signal ? <span>· signal {result.signal}</span> : null}
              </p>
            ) : null}
          </Panel>

          <Panel title="history" subtitle={`${history.length} runs this session`} icon="clock" padded={false}>
            <div className="scroll-thin max-h-[160px] overflow-y-auto">
              {history.map((entry) => (
                <button
                  key={`${entry.at}-${entry.binary}`}
                  type="button"
                  onClick={() => {
                    setBinary(entry.binary);
                    setArgs(entry.args);
                    setResult(entry.result);
                  }}
                  className="flex w-full items-center gap-2 border-b border-line-soft/60 px-2.5 py-1 text-left hover:bg-ice/[0.06]"
                >
                  <Chip tone={entry.result.exitCode === 0 ? "ok" : "bad"}>exit {entry.result.exitCode ?? "signal"}</Chip>
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-300">
                    {entry.binary} {entry.args}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] text-slate-500">{formatMs(entry.result.durationMs)}</span>
                </button>
              ))}
              {!history.length ? <p className="py-3 text-center text-[10.5px] text-slate-500">nothing run yet</p> : null}
            </div>
          </Panel>
        </div>

        <Panel title="detected binaries" subtitle="PATH scan" icon="search" padded={false} className="max-h-[calc(100vh-190px)]">
          <div className="scroll-thin h-full max-h-[calc(100vh-190px)] overflow-y-auto">
            <Table
              head={
                <tr className="border-b border-line">
                  <Th>binary</Th>
                  <Th>status</Th>
                </tr>
              }
            >
              {(binaries.data?.binaries ?? []).map((binaryInfo) => (
                <tr key={binaryInfo.name} className="cursor-pointer border-b border-line-soft/60" onClick={() => { setBinary(binaryInfo.name); setArgs(""); }}>
                  <Td>
                    <p className="font-mono text-[10.5px] text-slate-200">{binaryInfo.name}</p>
                    <p className="truncate font-mono text-[8.5px] text-slate-500" title={binaryInfo.version ?? binaryInfo.error}>
                      {binaryInfo.version ?? binaryInfo.error ?? "not found"}
                    </p>
                  </Td>
                  <Td>
                    <Chip tone={binaryInfo.installed ? "ok" : "muted"}>{binaryInfo.installed ? "installed" : "absent"}</Chip>
                  </Td>
                </tr>
              ))}
            </Table>
            {binaries.error ? <ErrorNote message={binaries.error} onRetry={binaries.refresh} /> : null}
            {binaries.loading ? <p className="p-3 text-[10.5px] text-slate-500">scanning…</p> : null}
          </div>
        </Panel>
      </div>

      <SaveToolModal
        open={toolOpen}
        onClose={() => setToolOpen(false)}
        defaults={{ binary, baseArgs: args, cwd }}
        onSaved={() => {
          tools.refresh();
          setNotice({ tone: "ok", message: "Preset saved to the library." });
        }}
      />
    </div>
  );
}

function SaveToolModal({
  open,
  onClose,
  defaults,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  defaults: { binary: string; baseArgs: string; cwd: string };
  onSaved: () => void;
}) {
  const [name, setName] = useState("my preset");
  const [category, setCategory] = useState("general");
  const [binary, setBinary] = useState(defaults.binary);
  const [baseArgs, setBaseArgs] = useState(defaults.baseArgs);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await postJson("/api/cli/tools", { name, binary, baseArgs, category, cwd: defaults.cwd || undefined });
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="save preset"
      footer={
        <div className="flex justify-end gap-1.5">
          <Button onClick={onClose}>cancel</Button>
          <Button variant="primary" icon="save" onClick={() => void submit()} disabled={!name.trim() || !binary.trim()}>
            save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2.5">
        <Field label="name" required>
          <TextInput value={name} onChange={setName} />
        </Field>
        <Field label="category">
          <Select
            value={category}
            onChange={setCategory}
            options={["general", "engine", "compose", "runtime", "scm", "utility", "iac", "database", "build", "observability"].map((value) => ({ value, label: value }))}
          />
        </Field>
        <Field label="binary" required>
          <TextInput value={binary} onChange={setBinary} />
        </Field>
        <Field label="base args">
          <TextArea value={baseArgs} onChange={setBaseArgs} rows={2} />
        </Field>
        {error ? <Notice tone="bad">{error}</Notice> : null}
      </div>
    </Modal>
  );
}
