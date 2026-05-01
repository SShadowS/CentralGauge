/**
 * Zod schemas for analyzer LLM output validation.
 * Wire format ↔ runtime types live in one place; parser uses safeParse.
 *
 * `AnalyzerEntrySchema` is the canonical definition; Plan F's confidence
 * scorer (`src/lifecycle/confidence.ts`) imports it from this module rather
 * than redefining a (possibly drifting) duplicate. If a future change to
 * confidence scoring requires fields outside this schema, extend the schema
 * here and update both consumers — never fork.
 */
import { z } from "zod";

export const ConfidenceLevelSchema = z.enum(["high", "medium", "low"]);

export const FixableAnalysisSchema = z.object({
  outcome: z.literal("fixable"),
  category: z.enum([
    "id_conflict",
    "syntax_error",
    "test_logic_bug",
    "task_definition_issue",
  ]),
  description: z.string().min(1),
  affectedFile: z.enum(["task_yaml", "test_al"]),
  // `fix` is intentionally permissive: parser overrides `filePath` with the
  // task's authoritative path regardless of what the LLM produced (LLMs
  // routinely drop the field or guess wrong paths). description/codeBefore/
  // codeAfter default to empty strings on absence so the parser can still
  // build a usable FixableAnalysisResult.
  fix: z.object({
    filePath: z.string().optional(),
    description: z.string().optional(),
    codeBefore: z.string().optional(),
    codeAfter: z.string().optional(),
  }),
  confidence: ConfidenceLevelSchema,
});

export const ModelShortcomingSchema = z.object({
  outcome: z.literal("model_shortcoming"),
  category: z.literal("model_knowledge_gap"),
  concept: z.string().min(1),
  alConcept: z.string().min(1),
  description: z.string().min(1),
  errorCode: z.string().optional(),
  generatedCode: z.string(),
  correctPattern: z.string().min(1),
  // D-prompt additions: analyzer proposes a registry-shaped slug, checks for
  // an existing match, and reports the cosine similarity score. null fields
  // permitted: when the analyzer cannot find any reasonable candidate the
  // endpoint creates a fresh concept (sub-0.70 band).
  concept_slug_proposed: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "kebab-case slug required"),
  concept_slug_existing_match: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)
    .nullable(),
  similarity_score: z.number().min(0).max(1).nullable(),
  confidence: ConfidenceLevelSchema,
});

export const AnalysisOutputSchema = z.discriminatedUnion("outcome", [
  FixableAnalysisSchema,
  ModelShortcomingSchema,
]);

export type AnalysisOutputParsed = z.infer<typeof AnalysisOutputSchema>;
export type ModelShortcomingParsed = z.infer<typeof ModelShortcomingSchema>;
export type FixableAnalysisParsed = z.infer<typeof FixableAnalysisSchema>;

/**
 * Re-exported under the canonical name used by Plan F's confidence scorer.
 * Plan F imports `AnalyzerEntrySchema` from this module; it does NOT define
 * its own. Any field additions to the analyzer entry shape MUST happen here.
 */
export const AnalyzerEntrySchema = ModelShortcomingSchema;
export type AnalyzerEntry = z.infer<typeof AnalyzerEntrySchema>;
