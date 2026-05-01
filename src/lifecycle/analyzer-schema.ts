/**
 * Zod schema for `model-shortcomings/<slug>.json` output produced by
 * `centralgauge verify --shortcomings-only`. Mirrors the
 * `ModelShortcomingsFile` shape from `src/verify/types.ts` plus the
 * `concept_slug_proposed` field added by Plan D-prompt's analyzer prompt.
 *
 * The schema is intentionally permissive (most fields optional) so the
 * orchestrator's analyze step can validate JSON files that predate Plan
 * D-prompt's analyzer prompt addition — the strict registry-shape
 * validation already lives in `src/verify/schema.ts AnalyzerEntrySchema`
 * for the prompt-loop side.
 *
 * @module src/lifecycle/analyzer-schema
 */

import { z } from "zod";

export const ModelShortcomingEntrySchema = z.object({
  concept: z.string().min(1),
  alConcept: z.string().min(1),
  description: z.string().min(1),
  correctPattern: z.string(),
  incorrectPattern: z.string(),
  errorCodes: z.array(z.string()),
  affectedTasks: z.array(z.string()),
  firstSeen: z.string(),
  occurrences: z.number().int().nonnegative(),
  // D-prompt addition (optional during transition):
  concept_slug_proposed: z.string().optional(),
  concept_slug_existing_match: z.string().nullable().optional(),
  similarity_score: z.number().nullable().optional(),
  /**
   * Per-entry confidence (0..1). Plan F's confidence scorer writes this
   * on the analyzer JSON; legacy files predating Plan F omit it (default 1).
   */
  confidence: z.number().min(0).max(1).optional(),
});

export const ModelShortcomingsFileSchema = z.object({
  model: z.string().min(1),
  lastUpdated: z.string(),
  shortcomings: z.array(ModelShortcomingEntrySchema),
});

export type AnalyzerOutput = z.infer<typeof ModelShortcomingsFileSchema>;
export type AnalyzerEntry = z.infer<typeof ModelShortcomingEntrySchema>;
