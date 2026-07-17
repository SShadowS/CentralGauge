/**
 * Tests for sandbox path translation containment (finding M4).
 *
 * translatePath maps container paths (C:\workspace\...) to host paths and
 * MUST reject anything that would escape the mapped workspace root:
 * traversal (`..`), segment-prefix confusion (C:\workspacefoo), and
 * host-absolute passthrough (D:\other\...).
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  PathContainmentError,
  translatePath,
} from "../../../mcp/path-translation.ts";

const mapping = {
  containerPath: "C:\\workspace",
  hostPath: "U:\\host\\ws",
};

Deno.test("translatePath", async (t) => {
  await t.step("identity when no mapping configured (non-sandbox)", () => {
    assertEquals(
      translatePath("C:\\anywhere\\app.al", null),
      "C:\\anywhere\\app.al",
    );
    assertEquals(translatePath("relative/path.al", null), "relative/path.al");
  });

  await t.step("maps a workspace file to the host path", () => {
    assertEquals(
      translatePath("C:\\workspace\\app.al", mapping),
      "U:\\host\\ws\\app.al",
    );
  });

  await t.step("maps nested paths and forward slashes", () => {
    assertEquals(
      translatePath("C:/workspace/sub/app.al", mapping),
      "U:\\host\\ws\\sub\\app.al",
    );
  });

  await t.step("maps the workspace root itself", () => {
    assertEquals(translatePath("C:\\workspace", mapping), "U:\\host\\ws");
    assertEquals(translatePath("C:\\workspace\\", mapping), "U:\\host\\ws");
  });

  await t.step("prefix match is case-insensitive", () => {
    assertEquals(
      translatePath("c:\\WORKSPACE\\app.al", mapping),
      "U:\\host\\ws\\app.al",
    );
  });

  await t.step("allows internal .. that stays inside the workspace", () => {
    assertEquals(
      translatePath("C:\\workspace\\sub\\..\\app.al", mapping),
      "U:\\host\\ws\\app.al",
    );
  });

  await t.step("throws on traversal escaping the workspace", () => {
    assertThrows(
      () => translatePath("C:\\workspace\\..\\..\\Windows\\x", mapping),
      PathContainmentError,
    );
  });

  await t.step("throws on traversal escaping via forward slashes", () => {
    assertThrows(
      () => translatePath("C:/workspace/../secrets.txt", mapping),
      PathContainmentError,
    );
  });

  await t.step("throws on segment-prefix confusion (C:\\workspacefoo)", () => {
    assertThrows(
      () => translatePath("C:\\workspacefoo\\x", mapping),
      PathContainmentError,
    );
  });

  await t.step("throws on host-absolute passthrough", () => {
    assertThrows(
      () => translatePath("D:\\other\\abs\\path", mapping),
      PathContainmentError,
    );
  });

  await t.step("throws on unrelated relative path when mapping exists", () => {
    assertThrows(
      () => translatePath("some\\relative\\path", mapping),
      PathContainmentError,
    );
  });
});
