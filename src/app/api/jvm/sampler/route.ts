import { guard, readJson } from "@/lib/api";
import { samplerStatus, saveSampler, startSampler, stopSampler } from "@/lib/jvm/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = new URL(request.url).searchParams.get("session");
  return guard(async () => {
    const result = session ? samplerStatus(session) : null;
    if (!result) throw new Error("sampler session not found");
    return { result, sessionId: session };
  });
}

export async function POST(request: Request) {
  return guard(async () => {
    const body = await readJson<{ target?: string; windowMs?: number; intervalMs?: number }>(request);
    if (!body.target) throw new Error("target is required");
    const result = await startSampler(body.target, { windowMs: body.windowMs, intervalMs: body.intervalMs });
    return { result };
  });
}

export async function DELETE(request: Request) {
  const session = new URL(request.url).searchParams.get("session") ?? "";
  return guard(async () => {
    const result = stopSampler(session);
    if (!result) throw new Error("sampler session not found");
    return { result, sessionId: session };
  });
}

export async function PATCH(request: Request) {
  const session = new URL(request.url).searchParams.get("session") ?? "";
  return guard(async () => ({ dump: await saveSampler(session) }));
}
