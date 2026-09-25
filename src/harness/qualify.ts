/**
 * The qualification manifest shared with M4 (M4-14 writes it; M1-38 and
 * M4-15 read it): per task, the immutable revision to judge, the positive
 * variant and every named naive variant.
 */

import { z } from "zod";
import { ConfigurationError } from "../errors.ts";

export const QualifyManifestSchema = z.strictObject({
  v: z.literal(1),
  refapp_version: z.string().min(1),
  tasks: z.record(
    z.string().regex(/^HX-\d{3}$/),
    z.strictObject({
      rev: z.string().min(1),
      positive: z.enum(["correct", "reference-tests"]),
      naive: z.array(z.string().regex(/^[A-Za-z0-9_-]+$/)).min(1),
    }),
  ),
});
export type QualifyManifest = z.output<typeof QualifyManifestSchema>;

export async function loadQualifyManifest(
  path: string,
): Promise<QualifyManifest> {
  let raw: unknown;
  try {
    raw = JSON.parse(await Deno.readTextFile(path));
  } catch (err) {
    throw new ConfigurationError(
      `qualification manifest ${path}: ${
        err instanceof Error ? err.message : err
      }`,
    );
  }
  const r = QualifyManifestSchema.safeParse(raw);
  if (!r.success) {
    throw new ConfigurationError(
      `qualification manifest ${path}: ${
        r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(
          "; ",
        )
      }`,
    );
  }
  return r.data;
}

/** Why the manifest refuses this (task, variant, rev), or null. */
export function variantAllowed(
  m: QualifyManifest,
  taskId: string,
  variant: string,
  rev: string | null,
): string | null {
  const t = m.tasks[taskId];
  if (!t) return `${taskId} is not listed in the qualification manifest`;
  if (rev !== t.rev) {
    return `${taskId} must be judged at ${t.rev} (got ${
      rev ?? "the working tree"
    })`;
  }
  const listed = [t.positive, ...t.naive.map((n) => `naive/${n}`)];
  return listed.includes(variant)
    ? null
    : `${taskId} variant ${variant} is not listed (listed: ${
      listed.join(", ")
    })`;
}
