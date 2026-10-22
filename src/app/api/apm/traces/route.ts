import { guard } from "@/lib/api";
import { tracesResponse } from "@/lib/apm";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return guard(async () =>
    tracesResponse({
      service: params.get("service") || undefined,
      status: (params.get("status") as "ok" | "error" | null) || undefined,
      minDuration: Number(params.get("minDuration") ?? 0) || undefined,
      limit: Math.min(100, Number(params.get("limit") ?? 40)),
    }),
  );
}
