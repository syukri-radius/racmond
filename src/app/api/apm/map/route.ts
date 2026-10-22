import { guard } from "@/lib/api";
import { apmMap, ensureServiceRegistry } from "@/lib/apm";
import { listAgents } from "@/lib/apm";

export const dynamic = "force-dynamic";

export async function GET() {
  return guard(async () => {
    await ensureServiceRegistry();
    const map = await apmMap();
    return { ...map, agents: await listAgents() };
  });
}
