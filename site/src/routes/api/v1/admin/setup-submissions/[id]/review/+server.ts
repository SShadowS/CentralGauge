import type { RequestHandler } from "./$types";
import { adminRoute, reviewSubmission } from "$lib/server/setup-submissions";

export const POST: RequestHandler = (event) =>
  adminRoute(event, reviewSubmission);
