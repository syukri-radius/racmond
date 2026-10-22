import { guard, readJson } from "@/lib/api";
import { captureDump, listDumps } from "@/lib/jvm/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("target") ?? undefined;
  return guard(async () => ({ dumps: await listDumps(target) }));
}

export async function POST(request: Request) {
  return guard(async () => {
    const body = await readJson<{ target?: string; kind?: "thread" | "heap" }>(request);
    if (!body.target) throw new Error("target is required");
    const dump = await captureDump(body.target, body.kind === "heap" ? "heap" : "thread");
    return { dump };
  });
}
