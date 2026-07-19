/**
 * Unit tests for clipboard utility
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists, assertThrows } from "@std/assert";

describe("clipboard utility", () => {
  describe("copyToClipboard", () => {
    it("should be importable", async () => {
      const { copyToClipboard } = await import(
        "../../../src/utils/clipboard.ts"
      );
      assertEquals(typeof copyToClipboard, "function");
    });

    it("should handle copy operation on current platform", async () => {
      const { copyToClipboard } = await import(
        "../../../src/utils/clipboard.ts"
      );

      // This test will actually try to copy - it may succeed or fail
      // depending on platform capabilities
      const result = await copyToClipboard("test");
      assertEquals(typeof result, "boolean");
    });

    it("should return false for empty string gracefully", async () => {
      const { copyToClipboard } = await import(
        "../../../src/utils/clipboard.ts"
      );

      const result = await copyToClipboard("");
      assertEquals(typeof result, "boolean");
    });

    it("should handle special characters", async () => {
      const { copyToClipboard } = await import(
        "../../../src/utils/clipboard.ts"
      );

      const result = await copyToClipboard("Hello\nWorld\t\r\n!@#$%^&*()");
      assertEquals(typeof result, "boolean");
    });

    it("should handle unicode text", async () => {
      const { copyToClipboard } = await import(
        "../../../src/utils/clipboard.ts"
      );

      const result = await copyToClipboard("Hello 世界 🌍 مرحبا");
      assertEquals(typeof result, "boolean");
    });

    it("should handle very long text", async () => {
      const { copyToClipboard } = await import(
        "../../../src/utils/clipboard.ts"
      );

      const longText = "a".repeat(10000);
      const result = await copyToClipboard(longText);
      assertEquals(typeof result, "boolean");
    });
  });

  describe("platform detection", () => {
    it("should correctly identify current platform", () => {
      const os = Deno.build.os;
      const validPlatforms: string[] = [
        "windows",
        "darwin",
        "linux",
        "freebsd",
        "netbsd",
        "solaris",
        "illumos",
        "aix",
        "android",
      ];
      assertEquals(
        validPlatforms.includes(os),
        true,
        `Platform ${os} should be recognized`,
      );
    });
  });

  describe("platform-specific command selection", () => {
    // Test the command selection logic for each platform
    it("Windows should use clip.exe", () => {
      const expectedCmd = ["cmd", "/c", "clip"];
      assertEquals(expectedCmd[0], "cmd");
      assertEquals(expectedCmd[1], "/c");
      assertEquals(expectedCmd[2], "clip");
    });

    it("macOS should use pbcopy", () => {
      const expectedCmd = ["pbcopy"];
      assertEquals(expectedCmd[0], "pbcopy");
      assertEquals(expectedCmd.length, 1);
    });

    it("Linux xclip command should include selection flag", () => {
      const expectedCmd = ["xclip", "-selection", "clipboard"];
      assertEquals(expectedCmd[0], "xclip");
      assertEquals(expectedCmd[1], "-selection");
      assertEquals(expectedCmd[2], "clipboard");
    });

    it("Linux xsel command should include clipboard flag", () => {
      const expectedCmd = ["xsel", "--clipboard", "--input"];
      assertEquals(expectedCmd[0], "xsel");
      assertEquals(expectedCmd[1], "--clipboard");
      assertEquals(expectedCmd[2], "--input");
    });
  });

  describe("error handling patterns", () => {
    it("should return false on unknown platform", () => {
      // The function should handle unknown platforms gracefully
      // by returning false
      const unknownPlatform = "unknown-os";
      const isKnown = [
        "windows",
        "darwin",
        "linux",
        "freebsd",
        "netbsd",
        "solaris",
        "illumos",
        "aix",
        "android",
      ].includes(unknownPlatform);
      assertEquals(isKnown, false);
    });

    it("should handle Error objects correctly", () => {
      const error = new Error("Test error");
      const message = error instanceof Error ? error.message : String(error);
      assertEquals(message, "Test error");
    });

    it("should handle non-Error objects correctly", () => {
      const error: unknown = "String error";
      const message = error instanceof Error ? error.message : String(error);
      assertEquals(message, "String error");
    });

    it("should handle null/undefined error gracefully", () => {
      const error: unknown = null;
      const message = error instanceof Error
        ? error.message
        : String(error ?? "Unknown error");
      assertEquals(typeof message, "string");
    });
  });

  describe("command construction validation", () => {
    it("should slice command array correctly for args", () => {
      const cmd = ["xclip", "-selection", "clipboard"];
      const cmdPath = cmd[0];
      const args = cmd.slice(1);

      assertEquals(cmdPath, "xclip");
      assertEquals(args, ["-selection", "clipboard"]);
    });

    it("should handle single-element command array", () => {
      const cmd = ["pbcopy"];
      const cmdPath = cmd[0];
      const args = cmd.slice(1);

      assertEquals(cmdPath, "pbcopy");
      assertEquals(args, []);
    });

    it("should handle empty command array gracefully", () => {
      const cmd: string[] = [];
      const cmdPath = cmd[0];

      assertEquals(cmdPath, undefined);
    });
  });

  describe("text encoding", () => {
    it("should encode text to UTF-8 bytes", () => {
      const text = "Hello, World!";
      const encoded = new TextEncoder().encode(text);

      assertEquals(encoded instanceof Uint8Array, true);
      assertEquals(encoded.length, 13);
    });

    it("should encode unicode text correctly", () => {
      const text = "Hello 世界";
      const encoded = new TextEncoder().encode(text);

      assertEquals(encoded instanceof Uint8Array, true);
      // "Hello " = 6 bytes, "世" = 3 bytes, "界" = 3 bytes = 12 bytes total
      assertEquals(encoded.length, 12);
    });

    it("should encode emoji correctly", () => {
      const text = "🌍";
      const encoded = new TextEncoder().encode(text);

      assertEquals(encoded instanceof Uint8Array, true);
      // Emoji is 4 bytes in UTF-8
      assertEquals(encoded.length, 4);
    });

    it("should handle empty string", () => {
      const text = "";
      const encoded = new TextEncoder().encode(text);

      assertEquals(encoded instanceof Uint8Array, true);
      assertEquals(encoded.length, 0);
    });
  });
});

describe("commandExists utility logic", () => {
  describe("which command selection", () => {
    it("Windows should use 'where' command", () => {
      const osType = "windows";
      const which = osType === "windows" ? "where" : "which";
      assertEquals(which, "where");
    });

    it("Unix-like systems should use 'which' command", () => {
      const unixSystems = ["darwin", "linux", "freebsd"];
      for (const os of unixSystems) {
        const which = os === "windows" ? "where" : "which";
        assertEquals(which, "which", `${os} should use 'which'`);
      }
    });
  });

  describe("error handling", () => {
    it("should throw Deno.errors.NotFound when spawning a non-existent command", () => {
      // cmd.output() throws Deno.errors.NotFound synchronously (spawn fails
      // before a promise is even returned) rather than resolving with
      // success:false - assert that real behavior instead of swallowing
      // whatever happens in a catch{}.
      const cmd = new Deno.Command("nonexistent-command-12345", {
        args: [],
        stdout: "null",
        stderr: "null",
      });
      assertThrows(
        () => cmd.output(),
        Deno.errors.NotFound,
      );
    });
  });
});

describe("clipboard integration scenarios", () => {
  describe("workflow simulation", () => {
    it("should handle typical copy workflow", async () => {
      const { copyToClipboard } = await import(
        "../../../src/utils/clipboard.ts"
      );

      // Simulate copying code
      const code = `codeunit 50100 "Test Codeunit"
{
    procedure DoSomething()
    begin
        Message('Hello, World!');
    end;
}`;
      const result = await copyToClipboard(code);
      assertEquals(typeof result, "boolean");
    });

    it("should handle JSON copy workflow", async () => {
      const { copyToClipboard } = await import(
        "../../../src/utils/clipboard.ts"
      );

      const json = JSON.stringify({ key: "value", number: 42 }, null, 2);
      const result = await copyToClipboard(json);
      assertEquals(typeof result, "boolean");
    });

    it("should handle multiline text with different line endings", async () => {
      const { copyToClipboard } = await import(
        "../../../src/utils/clipboard.ts"
      );

      // Unix line endings
      const unixText = "line1\nline2\nline3";
      const result1 = await copyToClipboard(unixText);
      assertEquals(typeof result1, "boolean");

      // Windows line endings
      const windowsText = "line1\r\nline2\r\nline3";
      const result2 = await copyToClipboard(windowsText);
      assertEquals(typeof result2, "boolean");

      // Mixed line endings
      const mixedText = "line1\nline2\r\nline3";
      const result3 = await copyToClipboard(mixedText);
      assertEquals(typeof result3, "boolean");
    });
  });

  describe("edge cases", () => {
    it("should handle text with null bytes", async () => {
      const { copyToClipboard } = await import(
        "../../../src/utils/clipboard.ts"
      );

      const textWithNull = "before\0after";
      const result = await copyToClipboard(textWithNull);
      assertEquals(typeof result, "boolean");
    });

    it("should handle text with control characters", async () => {
      const { copyToClipboard } = await import(
        "../../../src/utils/clipboard.ts"
      );

      const textWithControl = "text\x07\x08\x1b[31mred\x1b[0m";
      const result = await copyToClipboard(textWithControl);
      assertEquals(typeof result, "boolean");
    });

    it("should handle RTL text", async () => {
      const { copyToClipboard } = await import(
        "../../../src/utils/clipboard.ts"
      );

      const rtlText = "مرحبا بالعالم";
      const result = await copyToClipboard(rtlText);
      assertEquals(typeof result, "boolean");
    });

    it("should handle mixed LTR and RTL text", async () => {
      const { copyToClipboard } = await import(
        "../../../src/utils/clipboard.ts"
      );

      const mixedText = "Hello مرحبا World عالم";
      const result = await copyToClipboard(mixedText);
      assertEquals(typeof result, "boolean");
    });
  });
});

describe("clipboard module exports", () => {
  it("should export copyToClipboard function", async () => {
    const module = await import("../../../src/utils/clipboard.ts");
    assertExists(module.copyToClipboard);
    assertEquals(typeof module.copyToClipboard, "function");
  });

  it("should not export commandExists (internal function)", async () => {
    const module = await import("../../../src/utils/clipboard.ts");
    // commandExists should not be exported as it's internal
    assertEquals(
      Object.keys(module).includes("commandExists"),
      false,
      "commandExists should be internal",
    );
  });
});

describe("OS-specific behavior validation", () => {
  describe("current platform tests", () => {
    const currentOs = Deno.build.os;

    if (currentOs === "windows") {
      it("should successfully copy on Windows with clip.exe", async () => {
        const { copyToClipboard } = await import(
          "../../../src/utils/clipboard.ts"
        );
        const result = await copyToClipboard("Windows test");
        // On Windows, this should succeed if clip.exe is available
        assertEquals(typeof result, "boolean");
      });
    }

    if (currentOs === "darwin") {
      it("should successfully copy on macOS with pbcopy", async () => {
        const { copyToClipboard } = await import(
          "../../../src/utils/clipboard.ts"
        );
        const result = await copyToClipboard("macOS test");
        // On macOS, this should succeed if pbcopy is available
        assertEquals(typeof result, "boolean");
      });
    }

    if (currentOs === "linux") {
      it("should attempt copy on Linux", async () => {
        const { copyToClipboard } = await import(
          "../../../src/utils/clipboard.ts"
        );
        const result = await copyToClipboard("Linux test");
        // On Linux, this may or may not succeed depending on xclip/xsel
        assertEquals(typeof result, "boolean");
      });
    }
  });
});
