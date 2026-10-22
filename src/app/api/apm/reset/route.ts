import { guard } from "@/lib/api";
import { resetTelemetry } from "@/lib/apm";

export const dynamic = "force-dynamic";

export async function POST() {
  return guard(async () => resetTelemetry());
}
