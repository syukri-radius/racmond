import { OpsDashboard } from "@/components/ops/OpsDashboard";
import { getTopologyPayload } from "@/lib/topology-service";
import type { TopologyPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Server component performs the initial fetch of the full hierarchy so the
  // first paint already contains the topology; the client then attaches to the
  // live stream for metric updates.
  let payload: TopologyPayload | null = null;
  try {
    payload = await getTopologyPayload(12);
  } catch (error) {
    console.error("[ops] initial topology fetch failed", error);
  }
  return <OpsDashboard initial={payload} />;
}
