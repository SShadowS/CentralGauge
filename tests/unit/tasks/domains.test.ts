import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import { DOMAINS, DomainSchema, isDomain } from "../../../src/tasks/domains.ts";

describe("domains vocabulary", () => {
  it("isDomain accepts known domains", () => {
    assert(isDomain("tables"));
    assert(isDomain("flowfields"));
    assert(isDomain("codeunits"));
  });

  it("isDomain rejects unknown or non-string values", () => {
    assert(!isDomain("widgets"));
    assert(!isDomain(""));
    assert(!isDomain(42));
    assert(!isDomain(undefined));
  });

  it("DomainSchema parses a known domain", () => {
    assertEquals(DomainSchema.parse("interfaces"), "interfaces");
  });

  it("DomainSchema throws on an unknown domain", () => {
    assertThrows(() => DomainSchema.parse("not-a-domain"));
  });

  it("DOMAINS has no duplicate entries", () => {
    assertEquals(new Set(DOMAINS).size, DOMAINS.length);
  });
});
