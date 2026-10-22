import { guard } from "@/lib/api";
import { getSnapshot } from "@/lib/jvm/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("target");
  return guard(async () => ({ snapshot: await getSnapshot(target ?? "") }));
}
