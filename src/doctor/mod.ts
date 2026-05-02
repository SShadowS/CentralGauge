/**
 * Public re-exports for the doctor module.
 */
export { runDoctor } from "./engine.ts";
export { formatReportAsJson, formatReportToTerminal } from "./formatter.ts";
export type {
  Check,
  CheckLevel,
  CheckResult,
  CheckStatus,
  DoctorContext,
  DoctorReport,
  Remediation,
  RunDoctorOptions,
  Section,
  SectionId,
  VariantProbe,
} from "./types.ts";
export { ingestSection } from "./sections/ingest/mod.ts";
export { adminSection } from "./sections/admin/mod.ts";
