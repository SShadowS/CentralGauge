/**
 * Plan F / F6.5.1 — review queue page server loader.
 *
 * The CF Access JWT cookie set by the edge is forwarded automatically by
 * SvelteKit's server fetch (same isolate; no cross-origin), so the
 * authenticateAdminRequest gate on /api/v1/admin/lifecycle/review/queue
 * passes here.
 */
import type { PageServerLoad } from "./$types";

export interface ReviewEntry {
  id: number;
  analysis_event_id: number;
  model_slug: string;
  concept_slug_proposed: string;
  payload: {
    entry: {
      outcome?: string;
      category?: string;
      concept?: string;
      alConcept: string;
      description: string;
      errorCode?: string;
      generatedCode?: string;
      correctPattern: string;
      // Plan D-prompt batch endpoint emits these snake-case fields per
      // the canonical AnalyzerEntrySchema in src/verify/schema.ts.
      concept_slug_proposed: string;
      concept_slug_existing_match?: string | null;
      similarity_score?: number | null;
      confidence?: "high" | "medium" | "low";
      // Optional rationale wording; older entries may omit it.
      rationale?: string;
      // Plan D-data nests cluster metadata here.
      _cluster?: {
        nearest_concept_id?: number;
        similarity?: number;
        shortcoming_ids?: number[];
      };
    };
    confidence: {
      score: number;
      breakdown: {
        schema_validity: number;
        concept_cluster_consistency: number;
        cross_llm_agreement: number | null;
      };
      sampled_for_cross_llm: boolean;
      above_threshold: boolean;
      failure_reasons: string[];
    };
  };
  confidence: number;
  created_at: number;
  debug_session_id: string | null;
  r2_key: string | null;
  analyzer_model: string | null;
}

export const load: PageServerLoad = async ({ fetch }) => {
  const r = await fetch("/api/v1/admin/lifecycle/review/queue");
  if (!r.ok) {
    // Surface a clean error instead of crashing — the operator UI shows
    // the upstream code so they can act (re-auth via CF Access if 401,
    // wait for D1 to be reachable if 503, etc.).
    const body = (await r.text()) || `HTTP ${r.status}`;
    throw new Error(`queue fetch ${r.status}: ${body}`);
  }
  const body = (await r.json()) as { entries: ReviewEntry[]; count: number };
  return body;
};
