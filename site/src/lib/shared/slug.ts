/**
 * Canonical slug regex shared by every read AND write surface that
 * accepts a concept slug. Kebab-case, lowercase, must start AND end
 * with [a-z0-9] (no leading/trailing dash), no underscores or spaces.
 *
 * Read enforcement: GET /api/v1/concepts/[slug] (concepts/[slug]/+server.ts)
 * Write enforcement: POST /api/v1/admin/lifecycle/concepts/{merge,create,review-enqueue}
 *                    POST /api/v1/admin/lifecycle/cluster-review/decide
 *                    POST /api/v1/shortcomings/batch
 *
 * Without consistent validation, an admin-key holder could insert a
 * non-canonical slug ("Has Spaces & Caps") via a write endpoint. The
 * canonical reader rejects it as 400, so the row becomes unreachable —
 * an orphan in the registry that surfaces only via list endpoints.
 *
 * Side benefit: validating up-front prevents Cache API amplification
 * from junk slugs (each garbage URL becomes its own cache slot).
 */
import { z } from "zod";

export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export const slugSchema = z
  .string()
  .regex(SLUG_REGEX, "must be kebab-case slug");
