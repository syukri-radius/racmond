import { guard, readJson } from "@/lib/api";
import { mbeanBrowser, runMBeanOperation } from "@/lib/jvm/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("target") ?? "";
  return guard(async () => mbeanBrowser(target));
}

export async function POST(request: Request) {
  return guard(async () => {
    const body = await readJson<{ target?: string; action?: string }>(request);
    if (!body.target || !body.action) throw new Error("target and action are required");
    return runMBeanOperation(body.target, body.action);
  });
}
