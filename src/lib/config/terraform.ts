import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ConfigEdge, ConfigNode, Finding, TerraformModel } from "./types";

/**
 * Dependency-free structural HCL parser.
 *
 * 1. strip comments + heredocs with a string-aware scanner
 * 2. walk the body by brace matching → blocks with type, labels, attributes
 * 3. resolve references (resource./data./module./var./local.) into a graph
 * 4. flag the usual review findings
 */

interface HclBlock {
  type: string;
  labels: string[];
  attributes: Map<string, string>;
  blocks: HclBlock[];
  file: string;
}

/** Removes #, // and block comments plus heredoc bodies without touching strings. */
export function stripHclComments(input: string): string {
  let out = "";
  let i = 0;
  let inString = false;

  while (i < input.length) {
    const char = input[i];
    const next = input[i + 1];

    if (inString) {
      out += char;
      if (char === "\\" && next !== undefined) {
        out += next;
        i += 2;
        continue;
      }
      if (char === '"') inString = false;
      i += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      i += 1;
      continue;
    }

    // heredoc: <<EOF ... EOF  /  <<-EOF ... EOF
    if (char === "<" && next === "<") {
      const match = /^<<-?\s*"?([A-Za-z_][A-Za-z0-9_]*)"?/.exec(input.slice(i));
      if (match) {
        const terminator = match[1];
        const afterHeader = i + match[0].length;
        const lines = input.slice(afterHeader).split("\n");
        let consumed = afterHeader;
        let body = "";
        body += `<<${terminator}\n`;
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          consumed += line.length + 1;
          if (line.trim() === terminator) break;
          body += `${line}\n`;
        }
        out += body; // keep the heredoc text: references inside are resolved
        out += `\n${terminator}`;
        i = consumed;
        continue;
      }
    }

    if (char === "#" || (char === "/" && next === "/")) {
      while (i < input.length && input[i] !== "\n") i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }

    out += char;
    i += 1;
  }
  return out;
}

function findMatchingBrace(text: string, openIndex: number): number {
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

function readQuoted(text: string, index: number): { value: string; end: number } | null {
  if (text[index] !== '"') return null;
  let out = "";
  let i = index + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      out += text[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (text[i] === '"') return { value: out, end: i + 1 };
    out += text[i];
    i += 1;
  }
  return null;
}

/** Reads an attribute expression up to a newline at bracket depth 0. */
function readExpression(text: string, index: number): { value: string; end: number } {
  let depth = 0;
  let inString = false;
  let i = index;
  let out = "";
  while (i < text.length) {
    const char = text[i];
    if (inString) {
      out += char;
      if (char === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (char === '"') inString = false;
      i += 1;
      continue;
    }
    if (char === '"') inString = true;
    else if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (char === "\n" && depth <= 0) break;
    out += char;
    i += 1;
  }
  return { value: out.trim(), end: i };
}

function parseBody(text: string, file: string, start = 0, end = text.length): HclBlock[] {
  const blocks: HclBlock[] = [];
  let i = start;

  while (i < end) {
    const char = text[i];
    if (!/[A-Za-z_]/.test(char)) {
      i += 1;
      continue;
    }
    let cursor = i;
    let identifier = "";
    while (cursor < end && /[A-Za-z0-9_-]/.test(text[cursor])) {
      identifier += text[cursor];
      cursor += 1;
    }

    // skip whitespace between type and labels / brace
    let probe = cursor;
    while (probe < end && /\s/.test(text[probe])) probe += 1;

    if (text[probe] === "=" && text[probe + 1] !== "=") {
      // top-level attribute of a body — key/value pair inside a block-less file
      const { value, end: exprEnd } = readExpression(text, probe + 1);
      const block: HclBlock = { type: "attribute", labels: [identifier], attributes: new Map([[identifier, value]]), blocks: [], file };
      blocks.push(block);
      i = Math.max(exprEnd, probe + 1);
      continue;
    }

    const labels: string[] = [];
    probe = cursor;
    let foundBrace = -1;
    while (probe < end) {
      while (probe < end && /\s/.test(text[probe])) probe += 1;
      if (text[probe] === '"') {
        const quoted = readQuoted(text, probe);
        if (!quoted) break;
        labels.push(quoted.value);
        probe = quoted.end;
        continue;
      }
      if (text[probe] === "{") {
        foundBrace = probe;
        break;
      }
      // not a block (e.g. inline expression) — bail out
      if (text[probe] !== "\n") {
        probe = -1;
        break;
      }
      break;
    }
    if (probe === -1 || foundBrace < 0) {
      i = cursor;
      continue;
    }

    const close = findMatchingBrace(text, foundBrace);
    const body = text.slice(foundBrace + 1, close);
    const block: HclBlock = { type: identifier, labels, attributes: new Map(), blocks: [], file };
    parseInto(block, body, file);
    blocks.push(block);
    i = close + 1;
  }

  return blocks;
}

/** Parses a block body: attributes and nested blocks in order. */
function parseInto(block: HclBlock, body: string, file: string): void {
  let i = 0;
  while (i < body.length) {
    const char = body[i];
    if (!/[A-Za-z_]/.test(char)) {
      i += 1;
      continue;
    }
    let cursor = i;
    let identifier = "";
    while (cursor < body.length && /[A-Za-z0-9_-]/.test(body[cursor])) {
      identifier += body[cursor];
      cursor += 1;
    }
    let probe = cursor;
    while (probe < body.length && /\s/.test(body[probe])) probe += 1;

    if (body[probe] === "=" && body[probe + 1] !== "=") {
      const { value, end: exprEnd } = readExpression(body, probe + 1);
      block.attributes.set(identifier, value);
      i = Math.max(exprEnd, probe + 1);
      continue;
    }

    // nested block: labels then {
    const labels: string[] = [];
    let scan = cursor;
    let brace = -1;
    while (scan < body.length) {
      while (scan < body.length && /\s/.test(body[scan])) scan += 1;
      if (body[scan] === '"') {
        const quoted = readQuoted(body, scan);
        if (!quoted) break;
        labels.push(quoted.value);
        scan = quoted.end;
        continue;
      }
      if (body[scan] === "{") {
        brace = scan;
      }
      break;
    }
    if (brace >= 0) {
      const close = findMatchingBrace(body, brace);
      const nested: HclBlock = { type: identifier, labels, attributes: new Map(), blocks: [], file };
      parseInto(nested, body.slice(brace + 1, close), file);
      block.blocks.push(nested);
      i = close + 1;
      continue;
    }
    i = Math.max(cursor, i + 1);
  }
}

export function parseHcl(content: string, file = "main.tf"): HclBlock[] {
  return parseBody(stripHclComments(content), file);
}

/* ------------------------------------------------------------ references */

interface Reference {
  kind: "resource" | "data" | "module" | "var" | "local" | "unknown";
  address: string;
  via: string;
}

const RESERVED = new Set(["var", "local", "module", "data", "count", "each", "path", "terraform", "self", "provider"]);

function referencesIn(expression: string, attribute: string, resourceTypes: Set<string>): Reference[] {
  const refs: Reference[] = [];
  const add = (kind: Reference["kind"], address: string) => {
    if (!refs.some((ref) => ref.address === address && ref.via === attribute)) refs.push({ kind, address, via: attribute });
  };
  for (const match of expression.matchAll(/\bvar\.([A-Za-z0-9_-]+)/g)) add("var", `var.${match[1]}`);
  for (const match of expression.matchAll(/\blocal\.([A-Za-z0-9_-]+)/g)) add("local", `local.${match[1]}`);
  for (const match of expression.matchAll(/\bmodule\.([A-Za-z0-9_-]+)/g)) add("module", `module.${match[1]}`);
  for (const match of expression.matchAll(/\bdata\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/g)) add("data", `data.${match[1]}.${match[2]}`);
  for (const match of expression.matchAll(/\b([a-z][A-Za-z0-9_]*)\.([A-Za-z0-9_-]+)/g)) {
    const [, first, second] = match;
    if (RESERVED.has(first)) continue;
    if (resourceTypes.has(first)) add("resource", `${first}.${second}`);
    else add("unknown", `${first}.${second}`);
  }
  return refs;
}

/* ---------------------------------------------------------------- model */

export async function parseTerraformDirectory(directory: string): Promise<TerraformModel> {
  const resolved = path.resolve(directory);
  const entries = await readdir(resolved, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".tf")).map((entry) => entry.name).sort();
  if (!files.length) throw new Error(`no .tf files found in ${resolved}`);

  const blocks: HclBlock[] = [];
  for (const file of files) {
    const content = await readFile(path.join(resolved, file), "utf8");
    blocks.push(...parseHcl(content, file));
  }
  return buildTerraformModel(resolved, files, blocks);
}

export function parseTerraformSource(directory: string, files: Record<string, string>): TerraformModel {
  const blocks: HclBlock[] = [];
  for (const [file, content] of Object.entries(files)) {
    blocks.push(...parseHcl(content, file));
  }
  return buildTerraformModel(directory, Object.keys(files).sort(), blocks);
}

export function buildTerraformModel(directory: string, files: string[], blocks: HclBlock[]): TerraformModel {
  const findings: Finding[] = [];
  const nodes: ConfigNode[] = [];
  const edges: ConfigEdge[] = [];

  const resources = blocks.filter((block) => block.type === "resource" && block.labels.length >= 2);
  const dataSources = blocks.filter((block) => block.type === "data" && block.labels.length >= 2);
  const variables = blocks.filter((block) => block.type === "variable" && block.labels.length >= 1);
  const outputs = blocks.filter((block) => block.type === "output" && block.labels.length >= 1);
  const locals = blocks.filter((block) => block.type === "locals");
  const modules = blocks.filter((block) => block.type === "module" && block.labels.length >= 1);
  const providers = blocks.filter((block) => block.type === "provider" && block.labels.length >= 1);
  const terraformBlocks = blocks.filter((block) => block.type === "terraform");

  const resourceTypes = new Set(resources.map((block) => block.labels[0]));
  const declaredVars = new Set(variables.map((block) => block.labels[0]));
  const declaredLocals = new Set(locals.flatMap((block) => Array.from(block.attributes.keys())));
  const declaredModules = new Set(modules.map((block) => block.labels[0]));
  const declaredResources = new Set(resources.map((block) => `${block.labels[0]}.${block.labels[1]}`));
  const declaredData = new Set(dataSources.map((block) => `data.${block.labels[0]}.${block.labels[1]}`));

  const usedVars = new Set<string>();
  const usedLocals = new Set<string>();
  const usedModules = new Set<string>();
  const referencedAddresses = new Set<string>();
  const rootId = `tf:${path.basename(directory)}`;

  nodes.push({
    id: rootId,
    parentId: null,
    title: path.basename(directory) || "terraform",
    subtitle: `${files.length} .tf files · ${resources.length} resources`,
    kind: "module",
    chips: [`${resources.length} res`, `${variables.length} vars`, `${modules.length} modules`],
  });

  nodes.push({
    id: "tf:providers",
    parentId: rootId,
    title: "providers",
    subtitle: `${providers.length} configured`,
    kind: "providers",
    chips: providers.map((block) => block.labels[0]),
  });
  for (const provider of providers) {
    const alias = provider.attributes.get("alias");
    const id = `tf:provider:${provider.labels[0]}${alias ? `:${alias}` : ""}`;
    nodes.push({
      id,
      parentId: "tf:providers",
      title: provider.labels[0],
      subtitle: provider.attributes.get("region") ?? alias ?? "default",
      kind: "provider",
      chips: [alias ? `alias ${alias}` : "default", provider.file],
    });
  }

  const byType = new Map<string, HclBlock[]>();
  for (const resource of resources) {
    byType.set(resource.labels[0], [...(byType.get(resource.labels[0]) ?? []), resource]);
  }
  nodes.push({
    id: "tf:resources",
    parentId: rootId,
    title: "resources",
    subtitle: `${resources.length} across ${byType.size} types`,
    kind: "resources",
    chips: Array.from(byType.keys()).slice(0, 3),
  });
  for (const [type, list] of byType) {
    const typeId = `tf:type:${type}`;
    nodes.push({
      id: typeId,
      parentId: "tf:resources",
      title: type,
      subtitle: `${list.length} resource${list.length === 1 ? "" : "s"}`,
      kind: "resource-type",
      chips: [`${list.length}`, list[0].file],
    });
    for (const resource of list) {
      const address = `${type}.${resource.labels[1]}`;
      const id = `tf:resource:${address}`;
      const refs = Array.from(resource.attributes.entries()).flatMap(([attribute, expression]) =>
        referencesIn(expression, attribute, resourceTypes),
      );
      for (const ref of refs) {
        if (ref.kind === "var") usedVars.add(ref.address.slice(4));
        if (ref.kind === "local") usedLocals.add(ref.address.slice(6));
        if (ref.kind === "module") usedModules.add(ref.address.slice(7));
        if (ref.kind === "resource" || ref.kind === "data") referencedAddresses.add(ref.address);
      }
      nodes.push({
        id,
        parentId: typeId,
        title: resource.labels[1],
        subtitle: files.includes(resource.file) ? resource.file : `${resource.file}:1`,
        kind: "resource",
        chips: refs.slice(0, 3).map((ref) => ref.via),
      });
      for (const ref of refs) {
        const target =
          ref.kind === "resource"
            ? `tf:resource:${ref.address}`
            : ref.kind === "data"
              ? `tf:data:${ref.address}`
              : ref.kind === "var"
                ? `tf:var:${ref.address.slice(4)}`
                : ref.kind === "local"
                  ? `tf:local:${ref.address.slice(6)}`
                  : ref.kind === "module"
                    ? `tf:module:${ref.address.slice(7)}`
                    : null;
        if (target) edges.push({ source: id, target, label: ref.via });
      }
    }
  }

  if (dataSources.length) {
    nodes.push({
      id: "tf:data",
      parentId: rootId,
      title: "data sources",
      subtitle: `${dataSources.length}`,
      kind: "data",
      chips: dataSources.map((block) => block.labels[0]).slice(0, 3),
    });
    for (const source of dataSources) {
      const address = `data.${source.labels[0]}.${source.labels[1]}`;
      nodes.push({
        id: `tf:data:${address}`,
        parentId: "tf:data",
        title: source.labels[1],
        subtitle: source.labels[0],
        kind: "data-source",
        chips: [source.file],
      });
    }
  }

  if (modules.length) {
    nodes.push({
      id: "tf:modules",
      parentId: rootId,
      title: "child modules",
      subtitle: `${modules.length}`,
      kind: "modules",
      chips: modules.map((block) => block.labels[0]).slice(0, 3),
    });
    for (const module of modules) {
      const id = `tf:module:${module.labels[0]}`;
      nodes.push({
        id,
        parentId: "tf:modules",
        title: module.labels[0],
        subtitle: module.attributes.get("source") ?? "no source",
        kind: "module",
        chips: [module.attributes.get("version") ?? "unversioned", module.file],
      });
      for (const [attribute, expression] of module.attributes) {
        for (const ref of referencesIn(expression, attribute, resourceTypes)) {
          if (ref.kind === "var") usedVars.add(ref.address.slice(4));
          if (ref.kind === "resource" || ref.kind === "data") referencedAddresses.add(ref.address);
        }
      }
    }
  }

  nodes.push({
    id: "tf:vars",
    parentId: rootId,
    title: "input variables",
    subtitle: `${variables.length}`,
    kind: "variables",
    chips: variables.slice(0, 3).map((block) => block.labels[0]),
  });
  for (const variable of variables) {
    const name = variable.labels[0];
    const defaultValue = variable.attributes.get("default");
    const sensitive = (variable.attributes.get("sensitive") ?? "").trim() === "true";
    nodes.push({
      id: `tf:var:${name}`,
      parentId: "tf:vars",
      title: name,
      subtitle: defaultValue ? `default ${defaultValue.slice(0, 40)}` : "required",
      kind: "variable",
      chips: [sensitive ? "sensitive" : "plain", variable.attributes.get("type") ?? "any"],
    });
    if (sensitive && defaultValue) {
      findings.push({
        id: `sensitive-default-${name}`,
        severity: "error",
        code: "sensitive-default",
        message: `Variable "${name}" is sensitive but ships a default value — the secret lands in state and VCS.`,
        target: `tf:var:${name}`,
      });
    }
  }

  if (locals.length) {
    nodes.push({
      id: "tf:locals",
      parentId: rootId,
      title: "locals",
      subtitle: `${declaredLocals.size}`,
      kind: "locals",
      chips: Array.from(declaredLocals).slice(0, 3),
    });
    for (const name of declaredLocals) {
      nodes.push({
        id: `tf:local:${name}`,
        parentId: "tf:locals",
        title: name,
        subtitle: "local value",
        kind: "local",
        chips: ["local"],
      });
    }
  }

  nodes.push({
    id: "tf:outputs",
    parentId: rootId,
    title: "outputs",
    subtitle: `${outputs.length}`,
    kind: "outputs",
    chips: outputs.slice(0, 3).map((block) => block.labels[0]),
  });
  for (const output of outputs) {
    const name = output.labels[0];
    const value = output.attributes.get("value") ?? "";
    const refs = referencesIn(value, "value", resourceTypes);
    nodes.push({
      id: `tf:output:${name}`,
      parentId: "tf:outputs",
      title: name,
      subtitle: value.slice(0, 48),
      kind: "output",
      chips: [output.file],
    });
    for (const ref of refs) {
      if (ref.kind === "var") usedVars.add(ref.address.slice(4));
      if (ref.kind === "local") usedLocals.add(ref.address.slice(6));
      const resolved =
        ref.kind === "resource"
          ? declaredResources.has(ref.address)
          : ref.kind === "data"
            ? declaredData.has(ref.address)
            : ref.kind === "var"
              ? declaredVars.has(ref.address.slice(4))
              : ref.kind === "local"
                ? declaredLocals.has(ref.address.slice(6))
                : ref.kind === "module"
                  ? declaredModules.has(ref.address.slice(7))
                  : true;
      if (!resolved) {
        findings.push({
          id: `output-missing-${name}-${ref.address}`,
          severity: "error",
          code: "output-unresolved",
          message: `Output "${name}" references ${ref.address} which is not declared.`,
          target: `tf:output:${name}`,
        });
      }
    }
  }

  // reference checks
  for (const variable of variables) {
    if (!usedVars.has(variable.labels[0])) {
      findings.push({
        id: `unused-var-${variable.labels[0]}`,
        severity: "warning",
        code: "unused-variable",
        message: `Variable "${variable.labels[0]}" is declared but never referenced.`,
        target: `tf:var:${variable.labels[0]}`,
      });
    }
  }
  for (const name of usedVars) {
    if (!declaredVars.has(name)) {
      findings.push({
        id: `undeclared-var-${name}`,
        severity: "error",
        code: "undeclared-variable",
        message: `var.${name} is referenced but no variable block declares it.`,
      });
    }
  }
  for (const name of usedLocals) {
    if (!declaredLocals.has(name)) {
      findings.push({
        id: `undeclared-local-${name}`,
        severity: "error",
        code: "undeclared-local",
        message: `local.${name} is referenced but is not defined in any locals block.`,
      });
    }
  }
  for (const name of usedModules) {
    if (!declaredModules.has(name)) {
      findings.push({
        id: `undeclared-module-${name}`,
        severity: "error",
        code: "undeclared-module",
        message: `module.${name} is referenced but no module block declares it.`,
      });
    }
  }

  for (const resource of resources) {
    const address = `${resource.labels[0]}.${resource.labels[1]}`;
    if (!referencedAddresses.has(address)) {
      findings.push({
        id: `unreferenced-${address}`,
        severity: "info",
        code: "unreferenced-resource",
        message: `Resource ${address} is not referenced by anything — check it is intentional.`,
        target: `tf:resource:${address}`,
      });
    }
    for (const [attribute, expression] of resource.attributes) {
      if (/(access_key|secret_key|password|token)\b/i.test(attribute) && /"[^"]{6,}"/.test(expression) && !expression.includes("var.")) {
        findings.push({
          id: `hardcoded-${address}-${attribute}`,
          severity: "error",
          code: "hardcoded-credential",
          message: `${address}.${attribute} contains a hard-coded credential.`,
          target: `tf:resource:${address}`,
        });
      }
      if (/0\.0\.0\.0\/0/.test(expression) && resource.labels[0].includes("security_group")) {
        findings.push({
          id: `open-cidr-${address}-${attribute}`,
          severity: "warning",
          code: "open-cidr",
          message: `${address}.${attribute} allows 0.0.0.0/0 — restrict the CIDR range.`,
          target: `tf:resource:${address}`,
        });
      }
    }
  }

  const hasVersion = terraformBlocks.some((block) => block.attributes.has("required_version") || block.blocks.some((nested) => nested.type === "required_version"));
  if (!hasVersion) {
    findings.push({
      id: "missing-required-version",
      severity: "warning",
      code: "missing-required-version",
      message: "No terraform { required_version = ... } constraint — provider drift will hurt later.",
    });
  }
  const hasBackend = terraformBlocks.some((block) => block.blocks.some((nested) => nested.type === "backend"));
  if (!hasBackend) {
    findings.push({
      id: "missing-backend",
      severity: "warning",
      code: "missing-backend",
      message: "No remote state backend configured — state is local to whoever ran apply.",
    });
  }

  const inventory = {
    resources: resources.map((resource) => {
      const address = `${resource.labels[0]}.${resource.labels[1]}`;
      const references = Array.from(resource.attributes.entries()).flatMap(([attribute, expression]) =>
        referencesIn(expression, attribute, resourceTypes).map((ref) => `${attribute} → ${ref.address}`),
      );
      return { address, type: resource.labels[0], name: resource.labels[1], file: resource.file, references };
    }),
    variables: variables.map((variable) => ({
      name: variable.labels[0],
      type: variable.attributes.get("type") ?? "any",
      default: variable.attributes.get("default") ?? "(required)",
      sensitive: (variable.attributes.get("sensitive") ?? "").trim() === "true",
      used: usedVars.has(variable.labels[0]),
      file: variable.file,
    })),
    outputs: outputs.map((output) => ({ name: output.labels[0], value: output.attributes.get("value") ?? "", file: output.file })),
    providers: providers.map((provider) => ({
      name: provider.labels[0],
      alias: provider.attributes.get("alias") ?? null,
      file: provider.file,
    })),
    modules: modules.map((module) => ({
      name: module.labels[0],
      source: module.attributes.get("source") ?? "—",
      file: module.file,
    })),
  };

  return {
    kind: "terraform",
    directory,
    files,
    nodes,
    edges: edges.filter((edge) => nodes.some((node) => node.id === edge.target)),
    findings,
    inventory,
    counts: {
      resources: resources.length,
      data: dataSources.length,
      variables: variables.length,
      outputs: outputs.length,
      modules: modules.length,
      providers: providers.length,
    },
  };
}

export const DEMO_TERRAFORM: Record<string, string> = {
  "versions.tf": `terraform {
  required_version = ">= 1.6.0"
  backend "s3" {
    bucket = "vega-tfstate"
    key    = "shop/terraform.tfstate"
    region = "eu-west-1"
  }
}

provider "aws" {
  region = var.region
}
`,
  "variables.tf": `variable "region" {
  type    = string
  default = "eu-west-1"
}

variable "db_password" {
  type      = string
  sensitive = true
  default   = "hunter2"
}

variable "unused_flag" {
  type    = bool
  default = false
}

variable "instance_type" {
  type    = string
  default = "t3.small"
}
`,
  "main.tf": `data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
}

resource "aws_security_group" "web" {
  name = "web-sg"

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "web" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = var.instance_type
  subnet_id     = module.network.public_subnet_id

  tags = {
    Name = "vega-web"
  }
}

resource "aws_db_instance" "primary" {
  instance_class = "db.t3.medium"
  password       = var.db_password
  username       = "vega"
}

resource "aws_s3_bucket" "logs" {
  bucket = "vega-logs"
}

module "network" {
  source = "terraform-aws-modules/vpc/aws"
  version = "5.8.1"
  cidr   = "10.0.0.0/16"
}
`,
  "outputs.tf": `output "web_ip" {
  value = aws_instance.web.public_ip
}

output "db_endpoint" {
  value     = aws_db_instance.primary.endpoint
  sensitive = true
}

output "ghost" {
  value = aws_instance.missing.id
}
`,
};
