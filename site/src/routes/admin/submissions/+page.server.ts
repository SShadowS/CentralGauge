/**
 * Admin submission list loader. Same pattern as admin/lifecycle/review: the
 * CF Access JWT cookie is forwarded by SvelteKit's server fetch, so the
 * admin API gate passes.
 */
import type { PageServerLoad } from "./$types";

export interface SubmissionListRow {
  id: string;
  created_at: string;
  agent_tool: string;
  base_model: string;
  description: string;
  visibility: "public" | "private";
  status: "new" | "approved" | "rejected";
  has_key: boolean;
  key_expires_on: string | null;
  zip_bytes: number;
}

const STATUSES = ["new", "approved", "rejected"];

export const load: PageServerLoad = async ({ fetch, url }) => {
  const q = url.searchParams.get("status") ?? "new";
  const status = STATUSES.includes(q) || q === "all" ? q : "new";
  const r = await fetch("/api/v1/admin/setup-submissions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(status === "all" ? {} : { status }),
  });
  if (!r.ok) {
    const body = (await r.text()) || `HTTP ${r.status}`;
    throw new Error(`submissions fetch ${r.status}: ${body}`);
  }
  const body = (await r.json()) as { submissions: SubmissionListRow[] };
  return { status, submissions: body.submissions };
};
