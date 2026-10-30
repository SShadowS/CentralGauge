import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { ApiError, errorResponse } from "$lib/server/errors";
import { epochCachedJson } from "$lib/server/shared-cache";
import { getSetupDetail } from "$lib/server/setups";

export const GET: RequestHandler = async ({ request, params, platform }) => {
  const env = platform!.env;
  try {
    const payload = await epochCachedJson({
      db: env.DB,
      caches: platform!.caches,
      cacheName: "cg-setups",
      namespace: "setup-detail",
      params: { id: params.id ?? "" },
      compute: async () => {
        const detail = await getSetupDetail(env.DB, params.id!);
        if (!detail) {
          throw new ApiError(404, "setup_not_found", `No setup '${params.id}'`);
        }
        return detail;
      },
    });
    return cachedJson(request, payload);
  } catch (err) {
    return errorResponse(err);
  }
};
