import { guard } from "@/lib/api";
import { listContainers } from "@/lib/docker/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";
  return guard(async () => {
    const containers = await listContainers(force);
    const projects = Array.from(new Set(containers.map((c) => c.composeProject).filter(Boolean))) as string[];
    return { containers, projects };
  });
}
