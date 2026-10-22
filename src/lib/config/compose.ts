import { parse as parseYaml } from "yaml";
import type { ComposeModel, ConfigEdge, ConfigNode, Finding, ServiceRow } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === "string") return [value];
  return [];
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function portsOf(service: Record<string, any>): { text: string; host: number | null; container: number | null }[] {
  const list: { text: string; host: number | null; container: number | null }[] = [];
  for (const raw of Array.isArray(service.ports) ? service.ports : []) {
    if (typeof raw === "object" && raw) {
      const host = raw.published ? Number(raw.published) : null;
      const container = raw.target ? Number(raw.target) : null;
      list.push({ text: `${host ?? ""}:${container ?? ""}/${raw.protocol ?? "tcp"}`, host, container });
      continue;
    }
    const text = String(raw);
    const [hostPart, containerPart] = text.split(":");
    const container = Number(containerPart ?? hostPart);
    const host = containerPart !== undefined ? Number(hostPart) : null;
    list.push({ text, host: Number.isFinite(host) ? host : null, container: Number.isFinite(container) ? container : null });
  }
  return list;
}

function envEntries(service: Record<string, any>): { key: string; value: string }[] {
  if (Array.isArray(service.environment)) {
    return service.environment.map((entry: unknown) => {
      const text = String(entry);
      const index = text.indexOf("=");
      return index < 0 ? { key: text, value: "" } : { key: text.slice(0, index), value: text.slice(index + 1) };
    });
  }
  return Object.entries(asRecord(service.environment)).map(([key, value]) => ({ key, value: String(value ?? "") }));
}

function attachedNetworks(service: Record<string, any>): string[] {
  if (Array.isArray(service.networks)) return service.networks.map(String);
  return Object.keys(asRecord(service.networks));
}

function dependsOnEntries(service: Record<string, any>): { name: string; condition: string }[] {
  if (Array.isArray(service.depends_on)) return service.depends_on.map((name: unknown) => ({ name: String(name), condition: "started" }));
  return Object.entries(asRecord(service.depends_on)).map(([name, config]) => ({
    name,
    condition: String(asRecord(config).condition ?? "service_started"),
  }));
}

function tagOf(image: string): string {
  const withoutDigest = image.split("@")[0];
  const slash = withoutDigest.lastIndexOf("/");
  const colon = withoutDigest.lastIndexOf(":");
  if (colon > slash) return withoutDigest.slice(colon + 1);
  return "latest";
}

const SECRET_KEY = /(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)/i;

export function parseCompose(content: string, filename = "docker-compose.yml"): ComposeModel {
  const findings: Finding[] = [];
  let document: Record<string, any>;
  try {
    document = (parseYaml(content) ?? {}) as Record<string, any>;
  } catch (error) {
    return {
      kind: "compose",
      project: filename,
      version: null,
      nodes: [],
      edges: [],
      services: [],
      findings: [
        {
          id: "parse",
          severity: "error",
          code: "yaml-parse",
          message: `YAML could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      profiles: [],
      counts: { services: 0, ports: 0, volumes: 0, networks: 0, secrets: 0 },
    };
  }

  const services = asRecord(document.services);
  const declaredVolumes = Object.keys(asRecord(document.volumes));
  const declaredNetworks = Object.keys(asRecord(document.networks));
  const declaredSecrets = Object.keys(asRecord(document.secrets));
  const version = document.version ? String(document.version) : null;
  const project = String(document.name ?? filename.replace(/\.ya?ml$/, ""));
  const nodes: ConfigNode[] = [];
  const edges: ConfigEdge[] = [];
  const profiles = new Set<string>();

  const rootId = `compose:${project}`;
  nodes.push({
    id: rootId,
    parentId: null,
    title: project,
    subtitle: `${Object.keys(services).length} services · ${filename}`,
    kind: "project",
    chips: [`${Object.keys(services).length} services`, `${declaredVolumes.length} volumes`, `${declaredNetworks.length} networks`],
  });

  const serviceRows: ServiceRow[] = [];
  const hostPorts = new Map<number, string[]>();

  for (const [name, rawService] of Object.entries(services)) {
    const service = asRecord(rawService);
    const serviceId = `service:${name}`;
    const image = String(service.image ?? (service.build ? "build: ." : "unknown"));
    const ports = portsOf(service);
    const env = envEntries(service);
    const networks = attachedNetworks(service);
    const volumes = asArray(service.volumes);
    const deps = dependsOnEntries(service);
    const serviceProfiles = asArray(service.profiles);
    serviceProfiles.forEach((profile) => profiles.add(profile));

    for (const port of ports) {
      if (port.host !== null) {
        const owners = hostPorts.get(port.host) ?? [];
        if (!owners.includes(name)) owners.push(name);
        hostPorts.set(port.host, owners);
      }
    }

    nodes.push({
      id: serviceId,
      parentId: rootId,
      title: name,
      subtitle: image,
      kind: "service",
      chips: [`${ports.length} ports`, `${env.length} env`, image.split(":")[0].split("/").pop() ?? image],
    });

    if (ports.length) {
      const portsId = `${serviceId}:ports`;
      nodes.push({ id: portsId, parentId: serviceId, title: "ports", subtitle: `${ports.length} published`, kind: "ports", chips: ports.slice(0, 2).map((p) => p.text) });
      ports.forEach((port, index) => {
        nodes.push({
          id: `${portsId}:${index}`,
          parentId: portsId,
          title: port.text,
          subtitle: port.host !== null ? `host ${port.host} → container ${port.container}` : `container ${port.container}`,
          kind: "port",
          chips: [port.host !== null ? "published" : "internal"],
        });
      });
    }

    if (volumes.length) {
      const volumesId = `${serviceId}:volumes`;
      nodes.push({ id: volumesId, parentId: serviceId, title: "volumes", subtitle: `${volumes.length} mounts`, kind: "volumes", chips: volumes.slice(0, 2) });
      volumes.forEach((mount, index) => {
        const [source, destination] = mount.split(":");
        nodes.push({
          id: `${volumesId}:${index}`,
          parentId: volumesId,
          title: destination ?? mount,
          subtitle: source ?? "anonymous",
          kind: "volume",
          chips: [declaredVolumes.includes(source) ? "declared" : "bind/anonymous"],
        });
      });
    }

    if (env.length) {
      const envId = `${serviceId}:env`;
      nodes.push({ id: envId, parentId: serviceId, title: "env vars", subtitle: `${env.length} variables`, kind: "env", chips: env.slice(0, 2).map((entry) => entry.key) });
      env.forEach((entry, index) => {
        nodes.push({
          id: `${envId}:${index}`,
          parentId: envId,
          title: entry.key,
          subtitle: SECRET_KEY.test(entry.key) ? "•••• (masked)" : entry.value || "(empty)",
          kind: "env-var",
          chips: [SECRET_KEY.test(entry.key) ? "secret-key" : "config"],
        });
        if (SECRET_KEY.test(entry.key) && entry.value && !entry.value.includes("${")) {
          findings.push({
            id: `cred-${name}-${entry.key}`,
            severity: "error",
            code: "inlined-credential",
            message: `${name}.environment.${entry.key} contains an inlined credential — use ${"${VAR}"} or a secret.`,
            target: serviceId,
          });
        }
      });
    }

    if (networks.length) {
      const networksId = `${serviceId}:networks`;
      nodes.push({ id: networksId, parentId: serviceId, title: "networks", subtitle: `${networks.length} attached`, kind: "networks", chips: networks });
      networks.forEach((network) => {
        const networkNodeId = `network:${network}`;
        if (!nodes.some((node) => node.id === networkNodeId)) {
          nodes.push({
            id: networkNodeId,
            parentId: "resources:networks",
            title: network,
            subtitle: declaredNetworks.includes(network) ? "declared network" : "undeclared network",
            kind: "network",
            chips: [declaredNetworks.includes(network) ? "declared" : "implicit"],
          });
        }
        edges.push({ source: serviceId, target: networkNodeId, label: "attached" });
      });
    }

    if (service.healthcheck) {
      const health = asRecord(service.healthcheck);
      const test = Array.isArray(health.test) ? health.test.join(" ") : String(health.test ?? "");
      nodes.push({
        id: `${serviceId}:health`,
        parentId: serviceId,
        title: "healthcheck",
        subtitle: test.slice(0, 60) || "configured",
        kind: "healthcheck",
        chips: [health.interval ? `interval ${health.interval}` : "no interval", `${health.retries ?? "?"} retries`],
      });
    }

    for (const dep of deps) {
      edges.push({ source: serviceId, target: `service:${dep.name}`, label: dep.condition.replace("service_", "") });
      if (!services[dep.name]) {
        findings.push({
          id: `dep-${name}-${dep.name}`,
          severity: "error",
          code: "depends-on-missing",
          message: `${name} depends_on "${dep.name}" but no such service is defined.`,
          target: serviceId,
        });
      } else if (dep.condition === "service_healthy" && !asRecord(services[dep.name]).healthcheck) {
        findings.push({
          id: `dep-health-${name}-${dep.name}`,
          severity: "warning",
          code: "healthy-without-healthcheck",
          message: `${name} waits for ${dep.name} to be healthy, but ${dep.name} defines no healthcheck.`,
          target: serviceId,
        });
      }
    }

    if (service.build && !service.image) {
      findings.push({
        id: `build-${name}`,
        severity: "warning",
        code: "build-without-image",
        message: `${name} uses build without image — the built artifact is unnamed and cannot be pulled by other services.`,
        target: serviceId,
      });
    }

    if (image && !image.startsWith("build")) {
      const tag = tagOf(image);
      if (tag === "latest") {
        findings.push({
          id: `tag-${name}`,
          severity: "warning",
          code: "floating-tag",
          message: `${name} uses a floating tag (${image}) — pin a digest or an exact version.`,
          target: serviceId,
        });
      }
    }

    for (const mount of volumes) {
      const source = mount.split(":")[0];
      const named = source && !source.startsWith(".") && !source.startsWith("/") && !source.startsWith("~");
      if (named && !declaredVolumes.includes(source)) {
        findings.push({
          id: `vol-${name}-${source}`,
          severity: "warning",
          code: "missing-volume-declaration",
          message: `${name} mounts volume "${source}" which is not declared under top-level volumes.`,
          target: serviceId,
        });
      }
    }

    serviceRows.push({
      name,
      image,
      ports: ports.map((port) => port.text).join(", ") || "—",
      dependsOn: deps.map((dep) => `${dep.name}(${dep.condition.replace("service_", "")})`).join(", ") || "—",
      networks: networks.join(", ") || "default",
      volumes: volumes.join(", ") || "—",
      env: env.map((entry) => entry.key).join(", ") || "—",
      healthcheck: service.healthcheck ? "yes" : "no",
      profiles: serviceProfiles.join(", ") || "—",
    });
  }

  for (const [host, owners] of hostPorts) {
    if (owners.length > 1) {
      findings.push({
        id: `port-${host}`,
        severity: "error",
        code: "duplicate-host-port",
        message:
          owners.length > 1
            ? `Host port ${host} is published by ${owners.length} services (${owners.join(", ")}) — only one can bind.`
            : `Host port ${host} is published more than once by ${owners[0]} — only one mapping can bind.`,
      });
    }
  }

  // depends_on cycle detection (DFS)
  const adjacency = new Map<string, string[]>();
  for (const [name, rawService] of Object.entries(services)) {
    adjacency.set(name, dependsOnEntries(asRecord(rawService)).map((dep) => dep.name));
  }
  const state = new Map<string, "visiting" | "done">();
  const visit = (name: string, trail: string[]): void => {
    if (state.get(name) === "done") return;
    if (state.get(name) === "visiting") {
      const cycle = [...trail.slice(trail.indexOf(name)), name];
      findings.push({
        id: `cycle-${name}`,
        severity: "error",
        code: "depends-on-cycle",
        message: `depends_on cycle detected: ${cycle.join(" → ")}`,
        target: `service:${name}`,
      });
      return;
    }
    state.set(name, "visiting");
    for (const next of adjacency.get(name) ?? []) {
      if (adjacency.has(next)) visit(next, [...trail, name]);
    }
    state.set(name, "done");
  };
  for (const name of adjacency.keys()) visit(name, []);

  // declared resources branch
  nodes.push({
    id: "resources",
    parentId: rootId,
    title: "declared resources",
    subtitle: `${declaredVolumes.length} volumes · ${declaredNetworks.length} networks · ${declaredSecrets.length} secrets`,
    kind: "resources",
    chips: [`${declaredVolumes.length}V`, `${declaredNetworks.length}N`, `${declaredSecrets.length}S`],
  });
  nodes.push({ id: "resources:networks", parentId: "resources", title: "networks", subtitle: `${declaredNetworks.length} declared`, kind: "networks", chips: declaredNetworks.slice(0, 2) });
  for (const network of declaredNetworks) {
    if (nodes.some((node) => node.id === `network:${network}`)) continue;
    nodes.push({
      id: `network:${network}`,
      parentId: "resources:networks",
      title: network,
      subtitle: String(asRecord(asRecord(document.networks)[network]).driver ?? "bridge"),
      kind: "network",
      chips: [String(asRecord(asRecord(document.networks)[network]).driver ?? "bridge")],
    });
  }
  nodes.push({ id: "resources:volumes", parentId: "resources", title: "volumes", subtitle: `${declaredVolumes.length} declared`, kind: "volumes", chips: declaredVolumes.slice(0, 2) });
  for (const volume of declaredVolumes) {
    nodes.push({
      id: `volume:${volume}`,
      parentId: "resources:volumes",
      title: volume,
      subtitle: String(asRecord(asRecord(document.volumes)[volume]).driver ?? "local"),
      kind: "volume",
      chips: [String(asRecord(asRecord(document.volumes)[volume]).driver ?? "local")],
    });
  }
  if (declaredSecrets.length) {
    nodes.push({ id: "resources:secrets", parentId: "resources", title: "secrets", subtitle: `${declaredSecrets.length} declared`, kind: "secrets", chips: declaredSecrets.slice(0, 2) });
    for (const secret of declaredSecrets) {
      nodes.push({
        id: `secret:${secret}`,
        parentId: "resources:secrets",
        title: secret,
        subtitle: String(asRecord(asRecord(document.secrets)[secret]).file ?? "external"),
        kind: "secret",
        chips: ["secret"],
      });
    }
  }

  for (const network of declaredNetworks) {
    const used = Object.entries(services).some(([, raw]) => attachedNetworks(asRecord(raw)).includes(network));
    if (!used) {
      findings.push({
        id: `unused-network-${network}`,
        severity: "info",
        code: "unused-network",
        message: `Network "${network}" is declared but no service attaches to it.`,
        target: `network:${network}`,
      });
    }
  }

  if (version && Number.parseFloat(version) < 3.8) {
    findings.push({
      id: "version-old",
      severity: "info",
      code: "version-key",
      message: `Compose format version "${version}" is legacy — the version key is ignored by Compose V2.`,
    });
  }
  if (profiles.size) {
    findings.push({
      id: "profiles",
      severity: "info",
      code: "profiles",
      message: `Profiles in use: ${Array.from(profiles).join(", ")} — those services only start with --profile.`,
    });
  }
  for (const name of Object.keys(services)) {
    const row = serviceRows.find((entry) => entry.name === name);
    if (row && !row.ports.includes(":") && !row.ports.includes("/")) {
      findings.push({
        id: `no-ports-${name}`,
        severity: "info",
        code: "no-published-ports",
        message: `${name} publishes no host ports (internal-only service).`,
        target: `service:${name}`,
      });
    }
  }

  return {
    kind: "compose",
    project,
    version,
    nodes,
    edges: edges.filter((edge) => edge.target.startsWith("service:") || edge.target.startsWith("network:")),
    services: serviceRows,
    findings,
    profiles: Array.from(profiles),
    counts: {
      services: Object.keys(services).length,
      ports: serviceRows.reduce((sum, row) => sum + (row.ports === "—" ? 0 : row.ports.split(",").length), 0),
      volumes: declaredVolumes.length,
      networks: declaredNetworks.length,
      secrets: declaredSecrets.length,
    },
  };
}

export const DEMO_COMPOSE = `name: vega-shop
services:
  gateway:
    image: nginx:1.27-alpine
    ports:
      - "8080:80"
      - "8443:443"
    depends_on:
      api:
        condition: service_healthy
    networks: [frontend, backend]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/healthz"]
      interval: 10s
      retries: 3
  api:
    build: .
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://vega:supersecret@postgres:5432/shop
      JWT_SECRET: 8f4c2d1e9a
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
      missing-worker:
        condition: service_started
    networks: [backend]
    volumes:
      - uploads:/var/lib/uploads
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 15s
  orders:
    image: ghcr.io/vega/orders:latest
    ports:
      - "3000:3000"
    depends_on: [api]
    profiles: [checkout]
  postgres:
    image: postgres:16.4
    environment:
      POSTGRES_PASSWORD: supersecret
      POSTGRES_DB: shop
    volumes:
      - pgdata:/var/lib/postgresql/data
      - undeclared-cache:/cache
    networks: [backend]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vega"]
  redis:
    image: redis:7.4-alpine
    networks: [backend]
networks:
  frontend:
  backend:
  legacy:
volumes:
  pgdata:
  uploads:
`;
