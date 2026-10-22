import { guard } from "@/lib/api";
import { getLogs } from "@/lib/docker/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  return guard(async () => {
    const tail = Math.min(2000, Math.max(10, Number(url.searchParams.get("tail") ?? 250)));
    const logs = await getLogs(id, { tail, timestamps: url.searchParams.get("timestamps") !== "0" });
    return { logs, tail, fetchedAt: new Date().toISOString() };
  });
}
