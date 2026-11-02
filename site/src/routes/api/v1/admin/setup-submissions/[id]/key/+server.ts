import type { RequestHandler } from "./$types";
import { adminRoute, revealKey } from "$lib/server/setup-submissions";

export const POST: RequestHandler = (event) => adminRoute(event, revealKey);
