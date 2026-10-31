import type { RequestHandler } from "./$types";
import { adminRoute, submissionDetail } from "$lib/server/setup-submissions";

export const POST: RequestHandler = (event) =>
  adminRoute(event, ({ env, id }) => submissionDetail(env.DB, id));
