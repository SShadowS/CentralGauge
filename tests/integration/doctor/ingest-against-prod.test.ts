import { assertEquals } from "@std/assert";
import { ingestSection, runDoctor } from "../../../src/doctor/mod.ts";

const ENABLED = Deno.env.get("DOCTOR_E2E_PROD") === "1";

Deno.test({
  name: "doctor ingest — real prod end-to-end",
  ignore: !ENABLED,
  async fn() {
    const report = await runDoctor({ section: ingestSection });
    if (!report.ok) {
      console.error(JSON.stringify(report, null, 2));
    }
    // Auth-only run (no variants[]) — should pass against a healthy prod
    // when ~/.centralgauge.yml is configured.
    assertEquals(report.ok, true, "doctor ingest auth-only should pass");
  },
});
