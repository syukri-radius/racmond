import { guard } from "@/lib/api";
import { anatomy, getSnapshot } from "@/lib/jvm/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("target") ?? "";
  return guard(async () => {
    const snapshot = await getSnapshot(target);
    return { nodes: anatomy(snapshot), snapshot: { online: snapshot.online, error: snapshot.error, source: snapshot.source, name: snapshot.name } };
  });
}
