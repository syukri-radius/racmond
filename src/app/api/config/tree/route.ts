import { HttpError, guard, ok } from "@/lib/api";
import { fixtureListDirectory, listDirectory } from "@/lib/config/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/config/tree?repo=owner/name&path=&ref=main — one directory level. */
export async function GET(request: Request) {
  return guard(async () => {
    const params = new URL(request.url).searchParams;
    const repo = (params.get("repo") ?? "").trim();
    if (!repo) throw new HttpError(400, "repo is required");
    const path = params.get("path") ?? "";
    const ref = params.get("ref") ?? "main";
    if (params.get("fixture") === "1") return ok({ path, entries: fixtureListDirectory(path) });
    return ok({ path, entries: await listDirectory(repo, path, ref) });
  });
}
