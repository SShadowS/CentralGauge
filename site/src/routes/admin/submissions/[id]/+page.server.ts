import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export interface SubmissionDetail {
  id: string;
  status: "new" | "approved" | "rejected";
  created_at: string;
  agent_tool: string;
  base_model: string;
  description: string;
  visibility: "public" | "private";
  has_key: boolean;
  key_expires_on: string | null;
  setup_id: string | null;
  instructions_name: string;
  instructions_md: string;
  roles: Array<{ role: string; model: string; effort?: string | null }>;
  flow: string | null;
  zip_bytes: number;
  zip_sha256: string;
  review_note: string | null;
  reviewed_at: string | null;
}

export const load: PageServerLoad = async ({ fetch, params }) => {
  const r = await fetch(
    `/api/v1/admin/setup-submissions/${encodeURIComponent(params.id)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );
  if (r.status === 404) throw error(404, "Submission not found");
  if (!r.ok) {
    const body = (await r.text()) || `HTTP ${r.status}`;
    throw new Error(`submission fetch ${r.status}: ${body}`);
  }
  return { submission: (await r.json()) as SubmissionDetail };
};
