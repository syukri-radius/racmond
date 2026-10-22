import { guard } from "@/lib/api";
import { probeEngine } from "@/lib/docker/service";
import { ensureEndpoints } from "@/lib/docker/endpoints";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  return guard(async () => {
    const status = await probeEngine(force);
    const endpoints = await ensureEndpoints();
    return { status, endpoints };
  });
}
