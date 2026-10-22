import { guard, HttpError } from "@/lib/api";
import { getContainer, getLogs } from "@/lib/docker/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  return guard(async () => {
    const container = await getContainer(id);
    if (!container) throw new HttpError(404, `container ${id} not found`);
    const logs = url.searchParams.get("logs") === "1"
      ? await getLogs(id, { tail: Number(url.searchParams.get("tail") ?? 250), timestamps: true })
      : null;
    return { container, logs };
  });
}
