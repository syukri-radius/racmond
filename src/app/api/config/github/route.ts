import { HttpError, guard, ok } from "@/lib/api";
import { hasToken } from "@/lib/config/github";
import { loadGithub } from "@/lib/config/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/config/github?repo=owner/name&fixture=1&refresh=1 */
export async function GET(request: Request) {
  return guard(async () => {
    const params = new URL(request.url).searchParams;
    const repo = (params.get("repo") ?? "").trim();
    if (!repo) throw new HttpError(400, "repo is required (owner/name)");
    const model = await loadGithub(repo, {
      fixture: params.get("fixture") === "1" || params.get("fixture") === "true",
      refresh: params.get("refresh") === "1" || params.get("refresh") === "true",
    });
    return ok({ model, token: hasToken() });
  });
}
