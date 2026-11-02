import type { RequestHandler } from "./$types";
import { adminRoute, streamSubmissionZip } from "$lib/server/setup-submissions";

export const POST: RequestHandler = (event) =>
  adminRoute(event, ({ env, id }) => streamSubmissionZip(env, id));
