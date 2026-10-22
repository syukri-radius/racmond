import { guard } from "@/lib/api";
import { engineResources } from "@/lib/docker/service";
import type { ImageInfo, NetworkInfo, VolumeInfo } from "@/lib/docker/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind");
  return guard(async () => {
    const resources = await engineResources(true);
    if (kind === "images") return { kind, images: resources.images as ImageInfo[] };
    if (kind === "volumes") return { kind, volumes: resources.volumes as VolumeInfo[] };
    if (kind === "networks") return { kind, networks: resources.networks as NetworkInfo[] };
    return resources;
  });
}
