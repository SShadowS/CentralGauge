import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { errorResponse } from "$lib/server/errors";
import { epochCachedJson } from "$lib/server/shared-cache";
import { listSetupTaskSets } from "$lib/server/setups";

export const GET: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  try {
    const payload = await epochCachedJson({
      db: env.DB,
      caches: platform!.caches,
      cacheName: "cg-setups",
      namespace: "setup-task-sets",
      compute: async () => ({ sets: await listSetupTaskSets(env.DB) }),
    });
    return cachedJson(request, payload);
  } catch (err) {
    return errorResponse(err);
  }
};
