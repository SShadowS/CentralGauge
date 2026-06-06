// tests/unit/health/classify-publish-failure.test.ts
import { assertEquals } from "@std/assert";
import {
  classifyPublishFailure,
  isCollisionPublishFailure,
} from "../../../src/health/classify-publish-failure.ts";

Deno.test("classifyPublishFailure: object-ID collision after clean env is model", () => {
  const out =
    "PREPARE_CLEANUP_NONE\nPREPARE_PUBLISH_FAILED:Table 'Foo' is already defined in app 'CentralGauge_CG-AL-E001_1'";
  assertEquals(classifyPublishFailure(out), "model");
});

Deno.test("classifyPublishFailure: install-trigger error is model", () => {
  const out =
    "PREPARE_PUBLISH_FAILED:The OnInstallAppPerCompany trigger raised an error: invalid filter";
  assertEquals(classifyPublishFailure(out), "model");
});

Deno.test("classifyPublishFailure: schema-sync validation error is model", () => {
  const out =
    "PREPARE_PUBLISH_FAILED:Schema synchronization failed: destructive changes detected in table 70001";
  assertEquals(classifyPublishFailure(out), "model");
});

Deno.test("classifyPublishFailure: collision WITH cleanup-incomplete is infra", () => {
  const out =
    "PREREQ_CLEANUP_INCOMPLETE:2\nPREPARE_PUBLISH_FAILED:object is already defined in multiple apps";
  assertEquals(classifyPublishFailure(out), "infra");
});

Deno.test("classifyPublishFailure: PSSession loss during publish is infra", () => {
  assertEquals(
    classifyPublishFailure(
      "PUBLISH_FAILED:The PSSession was closed unexpectedly",
    ),
    "infra",
  );
});

Deno.test("classifyPublishFailure: connection closed during publish is infra", () => {
  assertEquals(
    classifyPublishFailure(
      "PUBLISH_FAILED:the underlying connection was closed",
    ),
    "infra",
  );
});

Deno.test("classifyPublishFailure: container offline during publish is infra", () => {
  assertEquals(
    classifyPublishFailure("PUBLISH_FAILED:container Cronus28 is not running"),
    "infra",
  );
});

Deno.test("classifyPublishFailure: infra signature wins over object mention", () => {
  const out =
    "PREPARE_PUBLISH_FAILED:object already defined; also: the underlying connection was closed";
  assertEquals(classifyPublishFailure(out), "infra");
});

Deno.test("classifyPublishFailure: unrecognized failure is unknown", () => {
  assertEquals(
    classifyPublishFailure("PREPARE_PUBLISH_FAILED:something weird happened"),
    "unknown",
  );
});

Deno.test("isCollisionPublishFailure: true only for duplicate-object phrasings", () => {
  assertEquals(
    isCollisionPublishFailure(
      "PREPARE_PUBLISH_FAILED:already defined in app X",
    ),
    true,
  );
  assertEquals(
    isCollisionPublishFailure(
      "PREPARE_PUBLISH_FAILED:defined in multiple apps",
    ),
    true,
  );
  assertEquals(
    isCollisionPublishFailure(
      "PREPARE_PUBLISH_FAILED:OnInstallAppPerCompany raised an error",
    ),
    false,
  );
});
