import {
  COMPOSITE_TEMPLATES,
  DIAGNOSE_TEMPLATES,
  type FormatSlug,
  KNOWN_COHORTS,
  KNOWN_TEMPLATES,
} from "../../../../site/src/lib/shared/taxonomy-schema.ts";

export interface ManifestFacts {
  id: string;
  prompt_template: string;
  cohort?: string;
  donors: string[];
  hasStarter: boolean;
}

export function deriveFormat(
  m: ManifestFacts,
): { group: FormatSlug | null; violations: string[] } {
  const v: string[] = [];
  const known = (KNOWN_TEMPLATES as readonly string[]).includes(
    m.prompt_template,
  );
  if (!known) v.push("unknown_template");
  if (
    m.cohort !== undefined &&
    !(KNOWN_COHORTS as readonly string[]).includes(m.cohort)
  ) v.push("unknown_cohort");
  if (v.length) return { group: null, violations: v };

  const isDiagnose = (DIAGNOSE_TEMPLATES as readonly string[]).includes(
    m.prompt_template,
  );
  let group: FormatSlug;
  if (m.donors.length > 0) group = "diagnose-composite";
  else if (isDiagnose) group = "diagnose-single";
  else if (m.cohort === "ado-trap-2026") group = "runtime-trap";
  else group = "build-from-spec";

  // Compatibility matrix (spec 4.1).
  switch (group) {
    case "diagnose-composite":
      if (
        !(COMPOSITE_TEMPLATES as readonly string[]).includes(m.prompt_template)
      ) v.push("composite_template");
      if (m.cohort !== "reasoning-100") v.push("cohort_mismatch");
      if (m.donors.length < 4 || m.donors.length > 8) v.push("donor_count");
      if (!m.hasStarter) v.push("starter_required");
      break;
    case "diagnose-single":
      if (m.cohort !== "reasoning-100" && m.cohort !== "ado-trap-2026") {
        v.push("cohort_mismatch");
      }
      if (!m.hasStarter) v.push("starter_required");
      break;
    case "runtime-trap":
      if (m.prompt_template !== "code-gen.md") v.push("template_mismatch");
      if (m.hasStarter) v.push("starter_forbidden");
      break;
    case "build-from-spec":
      if (m.cohort !== undefined) v.push("cohort_mismatch");
      if (m.hasStarter) v.push("starter_forbidden");
      break;
  }
  return { group, violations: v };
}
