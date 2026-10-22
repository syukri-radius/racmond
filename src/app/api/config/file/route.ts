import { HttpError, guard, ok } from "@/lib/api";
import { fixtureReadFile, readFilePreview } from "@/lib/config/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/config/file?repo=&path=&ref= — text preview, 400 KB ceiling. */
export async function GET(request: Request) {
  return guard(async () => {
    const params = new URL(request.url).searchParams;
    const repo = (params.get("repo") ?? "").trim();
    const path = params.get("path") ?? "";
    if (!repo) throw new HttpError(400, "repo is required");
    if (!path) throw new HttpError(400, "path is required");
    if (params.get("fixture") === "1") return ok(fixtureReadFile(path));
    return ok(await readFilePreview(repo, path, params.get("ref") ?? "main"));
  });
}
