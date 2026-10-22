import { guard } from "@/lib/api";
import { engineResources, listContainers, probeEngine } from "@/lib/docker/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";
  return guard(async () => {
    const status = await probeEngine(force);
    const containers = await listContainers(force);
    const resources = await engineResources(force);
    const projects = Array.from(
      new Map(
        containers
          .filter((c) => c.composeProject)
          .map((c) => [c.composeProject as string, { name: c.composeProject as string, containers: 0, running: 0 }]),
      ).values(),
    );
    for (const project of projects) {
      const members = containers.filter((c) => c.composeProject === project.name);
      project.containers = members.length;
      project.running = members.filter((c) => c.state === "running").length;
    }
    return {
      status,
      containers,
      projects,
      counts: {
        containers: containers.length,
        running: containers.filter((c) => c.state === "running").length,
        stopped: containers.filter((c) => c.state !== "running").length,
        attention: containers.filter((c) => c.state === "restarting" || c.health === "unhealthy" || (c.state === "exited" && (c.exitCode ?? 0) !== 0)).length,
        cpu: containers.reduce((sum, c) => sum + c.cpuPct, 0),
        memory: containers.reduce((sum, c) => sum + c.memoryBytes, 0),
      },
      resources: {
        images: resources.images.length,
        volumes: resources.volumes.length,
        networks: resources.networks.length,
        danglingVolumes: resources.volumes.filter((v) => !v.inUse).length,
        unusedImages: resources.images.filter((i) => i.containers === 0).length,
      },
    };
  });
}
