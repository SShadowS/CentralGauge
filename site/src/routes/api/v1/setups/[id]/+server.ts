import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { ApiError, errorResponse } from "$lib/server/errors";
import { epochCachedJson } from "$lib/server/shared-cache";
import { getSetupDetail } from "$lib/server/setups";
import { KNOWN_ISSUES } from "$lib/shared/setups";

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
    // Bundle-derived, so attached after the epoch cache.
    return cachedJson(request, { ...payload, known_issue: KNOWN_ISSUES[payload.setup.agent_tool] });
  } catch (err) {
    return errorResponse(err);
  }
};
