import type { RequestHandler } from "./$types";
import { handleEditLink } from "$lib/server/setup-submissions";

export const POST: RequestHandler = (event) => handleEditLink(event, "status");
