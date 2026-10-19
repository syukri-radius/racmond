import { db } from "@/db";
import { metrics as metricsTable, nodes as nodesTable } from "@/db/schema";
import { ensureSeeded, loadSeries, recentEvents, toTopologyNode } from "@/lib/seed";
import { engine, listRuns, startEngine } from "@/lib/telemetry";
import type { MetricSnapshot, TopologyNode, TopologyPayload } from "@/lib/types";
import { MONITORED_TYPES } from "@/lib/types";

/**
 * Single aggregation point for the hierarchy + telemetry snapshot. Used by the
 * server component (initial fetch) and by `/api/topology`.
 */
export async function getTopologyPayload(seriesPoints = 24): Promise<TopologyPayload> {
  await ensureSeeded();
  await startEngine();

  const rows = await db.select().from(nodesTable).orderBy(nodesTable.sortOrder);
  const metricRows = await db.select().from(metricsTable);

  const dbMetrics = new Map<string, MetricSnapshot>();
  for (const row of metricRows) {
    dbMetrics.set(row.nodeId, {
      cpu: row.cpu,
      memory: row.memory,
      disk: row.disk,
      networkIn: row.networkIn,
      networkOut: row.networkOut,
      requestsPerSec: row.requestsPerSec,
      errorRate: row.errorRate,
      latencyMs: row.latencyMs,
      uptimePct: row.uptimePct,
      replicasReady: row.replicasReady,
      replicasDesired: row.replicasDesired,
      source: row.source as MetricSnapshot["source"],
      updatedAt: new Date(row.updatedAt).toISOString(),
    });
  }

  const topologyNodes: TopologyNode[] = rows.map((row) => {
    const node = toTopologyNode(row);
    const liveStatus = engine.status.get(node.id);
    if (liveStatus) node.status = liveStatus;
    return node;
  });

  const metricMap: Record<string, MetricSnapshot> = {};
  for (const node of topologyNodes) {
    const snapshot = engine.live.get(node.id) ?? dbMetrics.get(node.id);
    if (snapshot) {
      metricMap[node.id] = snapshot;
    } else if (node.type === "resource" && node.parentId && metricMap[node.parentId]) {
      metricMap[node.id] = metricMap[node.parentId];
    }
  }

  const seriesIds = topologyNodes
    .filter((n) => MONITORED_TYPES.has(n.type) && n.type !== "resource")
    .map((n) => n.id);
  const series = await loadSeries(seriesIds, seriesPoints);
  for (const node of topologyNodes) {
    if (node.type === "resource" && node.parentId && series[node.parentId] && !series[node.id]) {
      series[node.id] = series[node.parentId];
    }
  }

  const [evts, runs] = await Promise.all([recentEvents(60), listRuns(25)]);

  return {
    nodes: topologyNodes,
    metrics: metricMap,
    series,
    events: evts,
    runs,
    generatedAt: new Date().toISOString(),
  };
}
