/**
 * Unit tests for the fix applicator
 */

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  applyFix,
  generateDiffPreview,
  type SuggestedFix,
  validateFix,
} from "../../../src/verify/mod.ts";
import { testTempFile } from "../../utils/temp-dir.ts";

Deno.test("fix-applicator: generateDiffPreview shows changes", () => {
  const fix: SuggestedFix = {
    fileType: "test_al",
    filePath: "test.al",
    description: "Fix test",
    codeBefore: "line1\nline2\nline3",
    codeAfter: "line1\nmodified\nline3",
  };

  const preview = generateDiffPreview(fix);

  assertStringIncludes(preview, "line1");
  assertStringIncludes(preview, "line2");
  assertStringIncludes(preview, "modified");
  assertStringIncludes(preview, "line3");
});

Deno.test("fix-applicator: generateDiffPreview handles empty fix", () => {
  const fix: SuggestedFix = {
    fileType: "test_al",
    filePath: "test.al",
    description: "Fix test",
    codeBefore: "",
    codeAfter: "",
  };

  const preview = generateDiffPreview(fix);
  assertStringIncludes(preview, "No diff available");
});

Deno.test("fix-applicator: applyFix replaces code correctly", async () => {
  // Create temp file
  const tempFile = await testTempFile({ suffix: ".al" });
  try {
    // Write initial content
    const initialContent = `procedure Test()
begin
    Assert.AreEqual(150.5, Warehouse."Total Qty", 'Error');
end;`;
    await Deno.writeTextFile(tempFile, initialContent);

    const fix: SuggestedFix = {
      fileType: "test_al",
      filePath: tempFile,
      description: "Add CalcFields call",
      codeBefore: `Assert.AreEqual(150.5, Warehouse."Total Qty", 'Error');`,
      codeAfter: `Warehouse.CalcFields("Total Qty");
    Assert.AreEqual(150.5, Warehouse."Total Qty", 'Error');`,
    };

    const result = await applyFix(fix);
    assertEquals(result, true);

    // Verify content was changed
    const newContent = await Deno.readTextFile(tempFile);
    assertStringIncludes(newContent, "CalcFields");
    assertStringIncludes(
      newContent,
      'Assert.AreEqual(150.5, Warehouse."Total Qty"',
    );
  } finally {
    await Deno.remove(tempFile);
  }
});

Deno.test("fix-applicator: applyFix returns false for missing file", async () => {
  const fix: SuggestedFix = {
    fileType: "test_al",
    filePath: "/nonexistent/path/test.al",
    description: "Fix test",
    codeBefore: "old",
    codeAfter: "new",
  };

  const result = await applyFix(fix);
  assertEquals(result, false);
});

Deno.test("fix-applicator: applyFix returns false when code not found", async () => {
  // Create temp file
  const tempFile = await testTempFile({ suffix: ".al" });
  try {
    await Deno.writeTextFile(tempFile, "some content that doesn't match");

    const fix: SuggestedFix = {
      fileType: "test_al",
      filePath: tempFile,
      description: "Fix test",
      codeBefore: "code that doesn't exist in file",
      codeAfter: "replacement",
    };

    const result = await applyFix(fix);
    assertEquals(result, false);
  } finally {
    await Deno.remove(tempFile);
  }
});

Deno.test("fix-applicator: validateFix reports errors for missing file", async () => {
  const fix: SuggestedFix = {
    fileType: "test_al",
    filePath: "/nonexistent/path/test.al",
    description: "Fix test",
    codeBefore: "old",
    codeAfter: "new",
  };

  const result = await validateFix(fix);
  assertEquals(result.valid, false);
  assertEquals(result.errors.length > 0, true);
  assertStringIncludes(result.errors[0]!, "not found");
});

Deno.test("fix-applicator: validateFix reports errors for missing codeBefore", async () => {
  // Create temp file
  const tempFile = await testTempFile({ suffix: ".al" });
  try {
    await Deno.writeTextFile(tempFile, "content");

    const fix: SuggestedFix = {
      fileType: "test_al",
      filePath: tempFile,
      description: "Fix test",
      codeBefore: "",
      codeAfter: "new",
    };

    const result = await validateFix(fix);
    assertEquals(result.valid, false);
    assertStringIncludes(result.errors.join(", "), "codeBefore");
  } finally {
    await Deno.remove(tempFile);
  }
});

Deno.test("fix-applicator: validateFix passes for valid fix", async () => {
  // Create temp file
  const tempFile = await testTempFile({ suffix: ".al" });
  try {
    const content = "line1\nline2\nline3";
    await Deno.writeTextFile(tempFile, content);

    const fix: SuggestedFix = {
      fileType: "test_al",
      filePath: tempFile,
      description: "Fix test",
      codeBefore: "line2",
      codeAfter: "modified",
    };

    const result = await validateFix(fix);
    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
  } finally {
    await Deno.remove(tempFile);
  }
});

Deno.test("fix-applicator: applyFix handles fuzzy whitespace matching", async () => {
  // Create temp file with different indentation
  const tempFile = await testTempFile({ suffix: ".al" });
  try {
    const initialContent = `procedure Test()
begin
    Assert.IsTrue(true);
end;`;
    await Deno.writeTextFile(tempFile, initialContent);

    // Fix with slightly different whitespace
    const fix: SuggestedFix = {
      fileType: "test_al",
      filePath: tempFile,
      description: "Replace assertion",
      codeBefore: "Assert.IsTrue(true);",
      codeAfter: "Assert.AreEqual(5, Result);",
    };

    const result = await applyFix(fix);
    assertEquals(result, true);

    const newContent = await Deno.readTextFile(tempFile);
    assertStringIncludes(newContent, "Assert.AreEqual");
  } finally {
    await Deno.remove(tempFile);
  }
});

// ============================================================================
// Multi-change format tests
// ============================================================================

Deno.test("fix-applicator: applyFix handles multi-change format with // ...", async () => {
  // Create temp file with multiple lines to replace
  const tempFile = await testTempFile({ suffix: ".al" });
  try {
    const initialContent = `codeunit 80017 "Test Codeunit"
{
    procedure TestOne()
    var
        Password: SecretText;
    begin
        Password := 'secret1';
    end;

    procedure TestTwo()
    var
        Password: SecretText;
    begin
        Password := 'secret2';
    end;
}`;
    await Deno.writeTextFile(tempFile, initialContent);

    // Multi-change fix with "// ..." separator
    const fix: SuggestedFix = {
      fileType: "test_al",
      filePath: tempFile,
      description: "Fix SecretText assignments",
      codeBefore: `Password := 'secret1';

// ...

Password := 'secret2';`,
      codeAfter: `Password := SecretText.SecretStrSubstNo('secret1');

// ...

Password := SecretText.SecretStrSubstNo('secret2');`,
    };

    const result = await applyFix(fix);
    assertEquals(result, true);

    const newContent = await Deno.readTextFile(tempFile);
    assertStringIncludes(newContent, "SecretText.SecretStrSubstNo('secret1')");
    assertStringIncludes(newContent, "SecretText.SecretStrSubstNo('secret2')");
    // Verify original lines are gone
    assertEquals(newContent.includes("Password := 'secret1';"), false);
    assertEquals(newContent.includes("Password := 'secret2';"), false);
  } finally {
    await Deno.remove(tempFile);
  }
});

Deno.test("fix-applicator: applyFix multi-change preserves indentation", async () => {
  const tempFile = await testTempFile({ suffix: ".al" });
  try {
    const initialContent = `procedure Test()
begin
        Value := 'old';
end;`;
    await Deno.writeTextFile(tempFile, initialContent);

    const fix: SuggestedFix = {
      fileType: "test_al",
      filePath: tempFile,
      description: "Replace value",
      codeBefore: "Value := 'old';",
      codeAfter: "Value := 'new';",
    };

    const result = await applyFix(fix);
    assertEquals(result, true);

    const newContent = await Deno.readTextFile(tempFile);
    // Check that indentation is preserved (8 spaces before Value)
    assertStringIncludes(newContent, "        Value := 'new';");
  } finally {
    await Deno.remove(tempFile);
  }
});

Deno.test("fix-applicator: applyFix multi-change returns false for mismatched counts", async () => {
  const tempFile = await testTempFile({ suffix: ".al" });
  try {
    await Deno.writeTextFile(tempFile, "a := 1;\nb := 2;");

    const fix: SuggestedFix = {
      fileType: "test_al",
      filePath: tempFile,
      description: "Mismatched changes",
      codeBefore: `a := 1;

// ...

b := 2;`,
      codeAfter: `a := 10;`, // Missing second change!
    };

    const result = await applyFix(fix);
    assertEquals(result, false);
  } finally {
    await Deno.remove(tempFile);
  }
});

Deno.test("fix-applicator: applyFix applies partial changes when some not found", async () => {
  const tempFile = await testTempFile({ suffix: ".al" });
  try {
    const initialContent = "found := 'yes';\n// some other code";
    await Deno.writeTextFile(tempFile, initialContent);

    const fix: SuggestedFix = {
      fileType: "test_al",
      filePath: tempFile,
      description: "Partial fix",
      codeBefore: `found := 'yes';

// ...

notfound := 'no';`,
      codeAfter: `found := 'replaced';

// ...

notfound := 'also replaced';`,
    };

    const result = await applyFix(fix);
    // Should still succeed with partial application
    assertEquals(result, true);

    const newContent = await Deno.readTextFile(tempFile);
    assertStringIncludes(newContent, "found := 'replaced'");
  } finally {
    await Deno.remove(tempFile);
  }
});
