import type { RequestHandler } from "./$types";
import { adminRoute } from "$lib/server/setup-submissions";
import { promoteSetupTaskSet } from "$lib/server/setup-publish";

export const POST: RequestHandler = (event) =>
  adminRoute(event, ({ env, actor, args }) =>
    promoteSetupTaskSet(env.DB, actor, args));
