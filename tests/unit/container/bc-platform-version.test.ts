// tests/unit/container/bc-platform-version.test.ts
//
// SAFETY: nothing here spawns docker, altool, or touches a container. Only the
// two pure functions are exercised; `resolvePlatformVersions` itself is covered
// by the operator check in scratch/probe-platform.ts against real containers.
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import {
  majorFromArtifactUrl,
  parseManifestVersions,
} from "../../../src/container/bc-platform-version.ts";

describe("majorFromArtifactUrl", () => {
  it("reads the major out of a real sandbox artifact URL", () => {
    assertEquals(
      majorFromArtifactUrl(
        "https://bcartifacts-exdbf9fwegejdqak.b02.azurefd.net/sandbox/28.4.53241.53758/dk",
      ),
      "28",
    );
  });

  it("would read a BC29 container without any code change", () => {
    // The whole point of the module: a newer container answers for itself.
    assertEquals(
      majorFromArtifactUrl(
        "https://bcartifacts.azureedge.net/sandbox/29.0.12345.67890/w1",
      ),
      "29",
    );
  });

  it("ignores a SAS token on the URL", () => {
    assertEquals(
      majorFromArtifactUrl(
        "https://example.net/sandbox/28.4.53241.53758/dk?sv=2021&sig=abc.def.1.2",
      ),
      "28",
    );
  });

  it("handles an onprem artifact path", () => {
    assertEquals(
      majorFromArtifactUrl("https://example.net/onprem/26.1.100.200/de"),
      "26",
    );
  });

  it("returns undefined when no segment looks like a version", () => {
    assertEquals(
      majorFromArtifactUrl("https://example.net/sandbox/latest/w1"),
      undefined,
    );
  });

  it("returns undefined on an empty URL", () => {
    assertEquals(majorFromArtifactUrl(""), undefined);
  });
});

describe("parseManifestVersions", () => {
  it("reads platform and runtime from an altool manifest", () => {
    // Trimmed from real altool GetPackageManifest output.
    const raw = JSON.stringify({
      id: "9856ae4f-d1a7-46ef-89bb-6ef056398228",
      name: "System Application Test Library",
      publisher: "Microsoft",
      version: "28.4.53241.53758",
      runtime: "17.0",
      target: "OnPrem",
      platform: "28.0.0.0",
    });
    assertEquals(parseManifestVersions(raw), {
      platform: "28.0.0.0",
      runtime: "17.0",
    });
  });

  it("omits a field the manifest does not carry rather than inventing one", () => {
    assertEquals(
      parseManifestVersions(JSON.stringify({ platform: "29.0.0.0" })),
      { platform: "29.0.0.0" },
    );
  });

  it("ignores a non-string value", () => {
    // A wrong TYPE must not become a version string; that would land in an
    // app.json and fail at compile time far from here.
    assertEquals(
      parseManifestVersions(JSON.stringify({ platform: 28, runtime: null })),
      {},
    );
  });

  it("returns nothing on non-JSON output", () => {
    assertEquals(
      parseManifestVersions("Unknown platform version: 28.0.0.0"),
      {},
    );
  });

  it("returns nothing on empty output", () => {
    assertEquals(parseManifestVersions(""), {});
  });
});
