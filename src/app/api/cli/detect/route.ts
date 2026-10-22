import { guard } from "@/lib/api";
import { detectBinaries } from "@/lib/cli";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limit = Math.min(20, Math.max(4, Number(new URL(request.url).searchParams.get("limit") ?? 20)));
  return guard(async () => ({ binaries: await detectBinaries(limit) }));
}
