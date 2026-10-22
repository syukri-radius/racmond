import { guard } from "@/lib/api";
import { deleteDump, getDump } from "@/lib/jvm/service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return guard(async () => ({ dump: await getDump(Number(id)) }));
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return guard(async () => {
    await deleteDump(Number(id));
    return { ok: true };
  });
}
