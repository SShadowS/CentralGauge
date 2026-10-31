import type { RequestHandler } from "./$types";
import { adminRoute, listSubmissions } from "$lib/server/setup-submissions";

export const POST: RequestHandler = (event) =>
  adminRoute(event, ({ env, args }) => listSubmissions(env.DB, args.status));
