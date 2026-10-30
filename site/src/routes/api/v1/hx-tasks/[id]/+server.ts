import type { RequestHandler } from "./$types";
import type { HxTaskResponse } from "$lib/shared/api-types";
import { cachedJson } from "$lib/server/cache";
import { ApiError, errorResponse } from "$lib/server/errors";
import { epochCachedJson } from "$lib/server/shared-cache";
import { getHxTaskResults, listSetupTaskSets } from "$lib/server/setups";

export const GET: RequestHandler = async ({ request, url, params, platform }) => {
  const env = platform!.env;
  try {
    const set = url.searchParams.get("set") ?? "";
    const payload = await epochCachedJson<HxTaskResponse>({
      db: env.DB,
      caches: platform!.caches,
      cacheName: "cg-setups",
      namespace: "hx-task",
      params: { id: params.id ?? "", set },
      compute: async () => {
        const sets = await listSetupTaskSets(env.DB);
        const taskSet = set
          ? sets.find((s) => s.hash === set)
          : sets.find((s) => s.is_current);
        if (!taskSet) {
          throw new ApiError(404, "set_not_found", "No such setup task set");
        }
        const found = await getHxTaskResults(env.DB, taskSet.hash, params.id!);
        if (!found) {
          throw new ApiError(404, "task_not_found", `No task '${params.id}' in this set`);
        }
        // summary is wired in by the task summaries work (Task 9).
        return { id: params.id!, summary: null, task_set: taskSet, results: found.results };
      },
    });
    return cachedJson(request, payload);
  } catch (err) {
    return errorResponse(err);
  }
};
