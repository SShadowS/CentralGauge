import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { CodeExtractor } from "../../../src/llm/code-extractor.ts";

describe("CodeExtractor", () => {
  describe("extract()", () => {
    describe("AL code extraction", () => {
      it("should extract AL code from custom delimiters", () => {
        const response = `
Here's the AL code solution:

BEGIN-CODE
codeunit 50100 "Test Codeunit"
{
    procedure CalculateTotal(Amount: Decimal): Decimal
    begin
        exit(Amount * 1.1);
    end;
}
END-CODE

This code calculates the total with tax.`;

        const result = CodeExtractor.extract(response, "al");

        assertEquals(result.language, "al");
        assertEquals(result.extractedFromDelimiters, true);
        assertEquals(result.confidence, 0.95);
        assert(result.code.includes("codeunit 50100"));
        assert(!result.code.includes("BEGIN-CODE"));
        assert(!result.code.includes("END-CODE"));
      });

      it("should extract AL code from markdown code blocks", () => {
        const response = `
Here's the solution:

\`\`\`al
table 50100 "Customer Extension"
{
    fields
    {
        field(1; "Entry No."; Integer)
        {
            AutoIncrement = true;
        }
    }
}
\`\`\``;

        const result = CodeExtractor.extract(response, "al");

        assertEquals(result.language, "al");
        assertEquals(result.extractedFromDelimiters, true);
        assertEquals(result.confidence, 0.9);
        assert(result.code.includes("table 50100"));
        assert(!result.code.includes("```"));
      });

      it("should extract AL code from various markdown language hints", () => {
        const languages = ["csharp", "c#", "cs", "pascal"];

        languages.forEach((lang) => {
          const response = `\`\`\`${lang}
procedure TestProc()
begin
    Message('Hello');
end;
\`\`\``;

          const result = CodeExtractor.extract(response, "al");
          assertEquals(result.language, "al");
          assertEquals(result.confidence, 0.9);
          assert(result.code.includes("procedure TestProc"));
        });
      });

      it("should detect AL code from patterns without delimiters", () => {
        const response = `codeunit 50100 "Inventory Manager"
{
    trigger OnRun()
    begin
        Message('Running inventory check');
    end;
    
    var
        ItemRec: Record Item;
}`;

        const result = CodeExtractor.extract(response, "al");

        assertEquals(result.language, "al");
        assertEquals(result.confidence, 0.7);
        assert(result.code.includes("codeunit 50100"));
      });

      it("should handle empty or invalid responses", () => {
        const emptyResult = CodeExtractor.extract("", "al");
        assertEquals(emptyResult.confidence, 0.1);
        assertEquals(emptyResult.code, "");

        const invalidResult = CodeExtractor.extract(
          "This is just plain text",
          "al",
        );
        assert(invalidResult.confidence <= 0.3);
      });
    });

    describe("Diff extraction", () => {
      it("should extract diff from custom delimiters", () => {
        const response = `
Here's the diff for the changes:

BEGIN-DIFF
--- a/file.al
+++ b/file.al
@@ -1,5 +1,5 @@
 codeunit 50100 "Test"
 {
-    procedure OldName()
+    procedure NewName()
     begin
     end;
 }
END-DIFF`;

        const result = CodeExtractor.extract(response, "diff");

        assertEquals(result.language, "diff");
        assertEquals(result.extractedFromDelimiters, true);
        assertEquals(result.confidence, 0.95);
        assert(result.code.includes("--- a/file.al"));
        assert(result.code.includes("+++ b/file.al"));
        assert(!result.code.includes("BEGIN-DIFF"));
      });

      it("should extract diff from markdown code blocks", () => {
        const response = `
\`\`\`diff
--- a/test.al
+++ b/test.al
@@ -10,7 +10,7 @@
     var
-        OldVar: Integer;
+        NewVar: Decimal;
\`\`\``;

        const result = CodeExtractor.extract(response, "diff");

        assertEquals(result.language, "diff");
        assertEquals(result.confidence, 0.9);
        assert(result.code.includes("-        OldVar: Integer;"));
        assert(result.code.includes("+        NewVar: Decimal;"));
      });

      it("should detect diff patterns without delimiters", () => {
        const response = `--- a/original.al
+++ b/modified.al
@@ -1,3 +1,4 @@
+// New comment
 codeunit 50100 "Test"
 {
     procedure Calculate()`;

        const result = CodeExtractor.extract(response, "diff");

        assertEquals(result.language, "diff");
        assert(result.confidence >= 0.7);
        assert(result.code.includes("+// New comment"));
      });
    });

    describe("Self-correction (multiple delimiter blocks)", () => {
      it("should extract the LAST BEGIN-CODE block when model self-corrects", () => {
        const response = `
Here's the AL code:

BEGIN-CODE
codeunit 70001 "String Concat Approach"
{
    procedure BuildString(): Text
    begin
        exit('Hello' + ' ' + 'World');
    end;
}
END-CODE

Wait, I need to reconsider. The task asks for TextBuilder approach...

BEGIN-CODE
codeunit 70001 "TextBuilder Approach"
{
    procedure BuildString(): Text
    var
        Builder: TextBuilder;
    begin
        Builder.Append('Hello');
        Builder.Append(' ');
        Builder.Append('World');
        exit(Builder.ToText());
    end;
}
END-CODE

This corrected version uses TextBuilder as required.`;

        const result = CodeExtractor.extract(response, "al");

        assertEquals(result.language, "al");
        assertEquals(result.extractedFromDelimiters, true);
        assertEquals(result.confidence, 0.95);
        // Should get the LAST block (self-corrected version)
        assert(result.code.includes("TextBuilder Approach"));
        assert(result.code.includes("Builder.Append"));
        // Should NOT contain the first block's content
        assert(!result.code.includes("String Concat Approach"));
        // Should NOT contain explanation text between blocks
        assert(!result.code.includes("Wait, I need to reconsider"));
      });

      it("should still extract single BEGIN-CODE block correctly", () => {
        const response = `
BEGIN-CODE
codeunit 70001 "Simple Test"
{
    procedure DoSomething()
    begin
        Message('Hello');
    end;
}
END-CODE`;

        const result = CodeExtractor.extract(response, "al");

        assertEquals(result.language, "al");
        assertEquals(result.extractedFromDelimiters, true);
        assertEquals(result.confidence, 0.95);
        assert(result.code.includes('codeunit 70001 "Simple Test"'));
      });

      it("should extract the LAST BEGIN-DIFF block when model self-corrects", () => {
        const response = `
BEGIN-DIFF
--- a/file.al
+++ b/file.al
@@ -1,3 +1,3 @@
-old line wrong
+new line wrong
END-DIFF

Actually, that diff was incorrect. Here's the right one:

BEGIN-DIFF
--- a/file.al
+++ b/file.al
@@ -5,3 +5,3 @@
-old line correct
+new line correct
END-DIFF`;

        const result = CodeExtractor.extract(response, "diff");

        assertEquals(result.language, "diff");
        assertEquals(result.extractedFromDelimiters, true);
        assertEquals(result.confidence, 0.95);
        // Should get the LAST diff block
        assert(result.code.includes("old line correct"));
        assert(result.code.includes("new line correct"));
        // Should NOT contain the first block
        assert(!result.code.includes("old line wrong"));
        assert(!result.code.includes("new line wrong"));
      });
    });

    describe("Language detection", () => {
      it("should detect language from code content", () => {
        const alCode = `codeunit 50100 "Test"
{
    procedure Calculate()
    var
        Amount: Decimal;
    begin
        exit(Amount);
    end;
}`;

        const diffCode = `--- a/file.al
+++ b/file.al
@@ -1,2 +1,2 @@
-old line
+new line`;

        const alResult = CodeExtractor.extract(alCode, "al");
        assertEquals(alResult.language, "al");

        const diffResult = CodeExtractor.extract(diffCode, "diff");
        assertEquals(diffResult.language, "diff");
      });

      it("should extract full code when rogue backticks appear mid-code", () => {
        const response = `\`\`\`al
codeunit 70001 "Shipping Provider Impl"
{
    procedure GenerateHash(): Text
    var
        HashPart: Text;
        HashSum: Integer;
    begin
        HashSum := 12345678;
        HashPart := Format(HashSum mod 100000000);
        // Pad to 8
\`\`\`
        while StrLen(HashPart) < 8 do
            HashPart := '0' + HashPart;
        exit(HashPart);
    end;
}
\`\`\``;

        const result = CodeExtractor.extract(response, "al");

        assertEquals(result.language, "al");
        assert(result.code.includes("while StrLen(HashPart) < 8 do"));
        assert(result.code.includes("exit(HashPart)"));
        assert(result.code.includes("GenerateHash"));
      });

      it("should concatenate ALL al-tagged blocks without prose between (T4)", () => {
        const twoBlocks =
          "intro\n```al\ntable 50100 A {}\n```\nprose between\n```al\ncodeunit 50101 B {}\n```\nafter";

        const result = CodeExtractor.extract(twoBlocks, "al");

        assertEquals(result.code, "table 50100 A {}\n\ncodeunit 50101 B {}");
        assertEquals(result.language, "al");
        assertEquals(result.extractedFromDelimiters, true);
      });

      it("should ignore a ```json block when an ```al block is present (T4)", () => {
        const response = "Here is the config:\n```json\n" +
          '{ "idRanges": [{ "from": 50100, "to": 50149 }] }\n' +
          "```\nAnd the code:\n```al\ncodeunit 50100 X {}\n```";

        const result = CodeExtractor.extract(response, "al");

        assertEquals(result.code, "codeunit 50100 X {}");
        assert(!result.code.includes("idRanges"));
      });

      it("should keep only AL-like blocks among multiple untagged fences (T4)", () => {
        const response = "```\ncodeunit 50100 X {}\n```\n" +
          "and the settings file:\n```\n" +
          '{ "key": true }\n' +
          "```";

        const result = CodeExtractor.extract(response, "al");

        assertEquals(result.code, "codeunit 50100 X {}");
        assert(!result.code.includes('"key"'));
      });

      it("should capture everything between first open and last close fence (multi-block greedy)", () => {
        const response = `\`\`\`al
codeunit 70001 "First Part"
{
}
\`\`\`

Some explanation text here.

\`\`\`al
codeunit 70002 "Second Part"
{
}
\`\`\``;

        const result = CodeExtractor.extract(response, "al");

        // Greedy matching captures everything between first open and last close
        assert(result.code.includes("First Part"));
        assert(result.code.includes("Second Part"));
      });

      it("should handle ambiguous code blocks", () => {
        const ambiguous = `\`\`\`
some code here
\`\`\``;

        const result = CodeExtractor.extract(ambiguous, "al");
        assert(result.extractedFromDelimiters);
        assert(result.confidence <= 0.8);
      });

      it("should extract cleanly when the closing fence is indented", () => {
        // The fence-line counter (:106) treats an indented ``` as a fence,
        // so this response passes the even-count check and routes to the
        // non-greedy parser. The parser's closer must accept the same
        // indented fence — otherwise the non-greedy match overruns the
        // block and swallows the trailing prose.
        const response = [
          "Here is the code:",
          "```al",
          "codeunit 50100 X { }",
          "    ```",
          "Some prose after the block.",
        ].join("\n");

        const result = CodeExtractor.extract(response, "al");

        assertEquals(result.code, "codeunit 50100 X { }");
        assert(!result.code.includes("Some prose"));
        assert(!result.code.includes("Here is the code"));
      });
    });
  });

  describe("cleanCode()", () => {
    it("should clean AL code artifacts", () => {
      const dirtyCode = `\`\`\`al
Here's the AL code for you:
codeunit 50100 "Test"
{
    procedure Test()
    begin
    end;
}
\`\`\``;

      const cleaned = CodeExtractor.cleanCode(dirtyCode, "al");

      assert(!cleaned.includes("```"));
      assert(!cleaned.includes("Here's the AL code"));
      assert(cleaned.startsWith("codeunit 50100"));
    });

    it("should normalize line endings", () => {
      const windowsEndings = "line1\r\nline2\r\nline3";
      const macEndings = "line1\rline2\rline3";

      const cleanedWindows = CodeExtractor.cleanCode(windowsEndings, "al");
      const cleanedMac = CodeExtractor.cleanCode(macEndings, "al");

      assertEquals(cleanedWindows, "line1\nline2\nline3");
      assertEquals(cleanedMac, "line1\nline2\nline3");
    });

    it("should strip backtick-only lines from AL code", () => {
      const codeWithRogueBackticks = `codeunit 70001 "Test"
{
    procedure DoStuff()
    begin
        Message('Hello');
\`\`\`
        Message('World');
    end;
}`;

      const cleaned = CodeExtractor.cleanCode(codeWithRogueBackticks, "al");

      assert(!cleaned.includes("```"));
      assert(cleaned.includes("Message('Hello')"));
      assert(cleaned.includes("Message('World')"));
      assert(cleaned.includes("codeunit 70001"));
    });

    it("should add diff headers if missing", () => {
      const diffWithoutHeaders = `@@ -1,3 +1,3 @@
-old line
+new line`;

      const cleaned = CodeExtractor.cleanCode(diffWithoutHeaders, "diff");

      assert(cleaned.includes("--- a/file.al"));
      assert(cleaned.includes("+++ b/file.al"));
    });
  });

  describe("validateCode()", () => {
    it("should validate AL code", () => {
      const validAL = `codeunit 50100 "Test"
{
    procedure Calculate()
    begin
        Message('Valid');
    end;
}`;

      const errors = CodeExtractor.validateCode(validAL, "al");
      assertEquals(errors.length, 0);
    });

    it("should detect invalid AL code", () => {
      const invalidAL = "This is not AL code at all";
      const errors = CodeExtractor.validateCode(invalidAL, "al");
      assert(errors.length > 0);
      assert(errors.length > 0);
      assert(errors[0]?.includes("doesn't appear to contain AL structures"));
    });

    it("should detect explanatory text in code", () => {
      const codeWithText = `Here's the solution:
\`\`\`al
codeunit 50100 "Test"
{
    begin
    end;
}
\`\`\``;

      const errors = CodeExtractor.validateCode(codeWithText, "al");
      assert(errors.some((e) => e.includes("explanatory text")));
    });

    it("should validate diff format", () => {
      const validDiff = `--- a/file.al
+++ b/file.al
@@ -1,2 +1,2 @@
-old
+new`;

      const errors = CodeExtractor.validateCode(validDiff, "diff");
      assertEquals(errors.length, 0);
    });

    it("should detect invalid diff", () => {
      const invalidDiff = "Just some regular text";
      const errors = CodeExtractor.validateCode(invalidDiff, "diff");
      assert(errors.length > 0);
      assert(errors.some((e) => e.includes("doesn't contain any changes")));
    });

    it("should handle empty code", () => {
      const errors = CodeExtractor.validateCode("", "al");
      assert(errors.length > 0);
      assert(errors.length > 0);
      assert(errors[0]?.includes("Empty code"));
    });
  });
});
