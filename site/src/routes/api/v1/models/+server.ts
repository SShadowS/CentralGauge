import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { errorResponse } from "$lib/server/errors";
import { listModels } from "$lib/server/models";

export const GET: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  try {
    const data = await listModels(env.DB);
    return cachedJson(request, { data });
  } catch (err) {
    return errorResponse(err);
  }
};
