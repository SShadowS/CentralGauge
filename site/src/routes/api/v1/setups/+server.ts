import type { RequestHandler } from "./$types";
import type { SetupsResponse } from "$lib/shared/api-types";
import { cachedJson } from "$lib/server/cache";
import { ApiError, errorResponse } from "$lib/server/errors";
import { epochCachedJson } from "$lib/server/shared-cache";
import { computeSetupRanking, listSetupTaskSets } from "$lib/server/setups";

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    const priv = url.searchParams.get("private");
    if (priv !== null && priv !== "1") {
      throw new ApiError(400, "invalid_private", "private accepts only 1");
    }
    const includePrivate = priv === "1";
    const set = url.searchParams.get("set") ?? "";
    const payload = await epochCachedJson<SetupsResponse>({
      db: env.DB,
      caches: platform!.caches,
      cacheName: "cg-setups",
      namespace: "setups-list",
      params: { set, private: includePrivate },
      compute: async () => {
        const sets = await listSetupTaskSets(env.DB);
        const taskSet = set
          ? sets.find((s) => s.hash === set)
          : sets.find((s) => s.is_current);
        if (set && !taskSet) {
          throw new ApiError(404, "set_not_found", `No setup task set '${set}'`);
        }
        if (!taskSet) return { task_set: null, rows: [] };
        return {
          task_set: taskSet,
          rows: await computeSetupRanking(env.DB, taskSet.hash, includePrivate),
        };
      },
    });
    return cachedJson(request, payload);
  } catch (err) {
    return errorResponse(err);
  }
};
