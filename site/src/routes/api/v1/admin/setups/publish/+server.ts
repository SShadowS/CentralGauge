import type { RequestHandler } from "./$types";
import { adminRoute } from "$lib/server/setup-submissions";
import { publishSetupRun } from "$lib/server/setup-publish";

export const POST: RequestHandler = (event) =>
  adminRoute(event, ({ env, actor, args }) =>
    publishSetupRun(env.DB, actor, args));
