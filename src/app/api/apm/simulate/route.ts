import { guard, readJson } from "@/lib/api";
import { simulateTraffic } from "@/lib/apm";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return guard(async () => {
    const body = await readJson<{ batch?: number }>(request).catch(() => ({ batch: 8 }));
    const batch = Math.min(40, Math.max(1, Number(body.batch ?? 8)));
    const result = await simulateTraffic(batch);
    return { ...result, batch, generatedAt: new Date().toISOString() };
  });
}
