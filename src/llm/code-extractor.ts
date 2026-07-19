export interface ExtractionResult {
  code: string;
  language: "al" | "diff" | "unknown";
  extractedFromDelimiters: boolean;
  confidence: number; // 0-1, how confident we are this is the right code
  originalResponse: string;
}

export class CodeExtractor {
  // Extract AL code or diff from LLM response
  static extract(
    response: string,
    expectedLanguage: "al" | "diff" = "al",
  ): ExtractionResult {
    const trimmed = response.trim();

    // Try extraction methods in order of preference
    const methods = [
      () => this.extractFromCustomDelimiters(trimmed, expectedLanguage),
      () => this.extractFromCodeBlocks(trimmed, expectedLanguage),
      () => this.extractFromCommonPatterns(trimmed, expectedLanguage),
      () => this.extractWholeResponse(trimmed, expectedLanguage),
    ];

    for (const method of methods) {
      const result = method();
      if (result.confidence > 0.5) {
        return result;
      }
    }

    // Return best attempt even if confidence is low
    return this.extractWholeResponse(trimmed, expectedLanguage);
  }

  // Extract from custom delimiters: BEGIN-CODE/END-CODE or BEGIN-DIFF/END-DIFF
  private static extractFromCustomDelimiters(
    response: string,
    expectedLanguage: "al" | "diff",
  ): ExtractionResult {
    const beginDelim = expectedLanguage === "diff"
      ? "BEGIN-DIFF"
      : "BEGIN-CODE";
    const endDelim = expectedLanguage === "diff" ? "END-DIFF" : "END-CODE";

    const pattern = new RegExp(
      `${beginDelim}\\s*\\n([\\s\\S]*?)\\n\\s*${endDelim}`,
      "gi",
    );
    const matches = [...response.matchAll(pattern)];
    const match = matches.length > 0 ? matches[matches.length - 1] : null;

    if (match && match[1]) {
      return {
        code: match[1].trim(),
        language: expectedLanguage,
        extractedFromDelimiters: true,
        confidence: 0.95,
        originalResponse: response,
      };
    }

    return {
      code: "",
      language: expectedLanguage,
      extractedFromDelimiters: false,
      confidence: 0,
      originalResponse: response,
    };
  }

  // Minimal AL-likeness check for untagged fenced blocks: keeps code blocks,
  // rejects fenced JSON/shell/config examples so they are never concatenated
  // into the candidate source.
  private static readonly AL_LIKENESS_RE =
    /\b(table|page|codeunit|report|query|xmlport|enum|interface|procedure|trigger)\b/i;

  // Parse ALL fenced code blocks non-greedily, in document order.
  //
  // The closing fence allows leading horizontal whitespace (`\n[^\S\n]*```)
  // so it agrees with the fence-line counter in extractFromCodeBlocks
  // (`/^[^\S\n]*```/gm`), which also counts an indented ```. If the closer
  // were anchored to column 0, an indented closing fence would pass the
  // even-count check but never match here, and the non-greedy body would
  // overrun to the next column-0 fence — swallowing prose into the block.
  private static parseFencedBlocks(
    response: string,
  ): Array<{ tag: string; content: string }> {
    const blocks: Array<{ tag: string; content: string }> = [];
    const pattern = /```([^\s`]*)[^\S\n]*\n([\s\S]*?)\n[^\S\n]*```/g;
    for (const match of response.matchAll(pattern)) {
      blocks.push({
        tag: (match[1] ?? "").toLowerCase(),
        content: (match[2] ?? "").trim(),
      });
    }
    return blocks;
  }

  // Extract from markdown code blocks
  private static extractFromCodeBlocks(
    response: string,
    expectedLanguage: "al" | "diff",
  ): ExtractionResult {
    const languagePatterns = expectedLanguage === "al"
      ? ["al", "csharp", "c#", "cs", "pascal"]
      : ["diff", "patch"];

    // Fence-marker lines must pair up (one opener + one closer per block).
    // An odd count means a rogue mid-code fence or an unclosed block; fall
    // back to the legacy greedy span so a spurious ``` inside the code does
    // not truncate the extraction (cleanCode strips backtick-only lines).
    const fenceLineCount = (response.match(/^[^\S\n]*```/gm) ?? []).length;
    if (fenceLineCount % 2 !== 0) {
      return this.extractFromCodeBlocksGreedy(
        response,
        expectedLanguage,
        languagePatterns,
      );
    }

    const blocks = this.parseFencedBlocks(response);
    if (blocks.length === 0) {
      return {
        code: "",
        language: expectedLanguage,
        extractedFromDelimiters: false,
        confidence: 0,
        originalResponse: response,
      };
    }

    // Language-tagged blocks take priority over untagged/other fences.
    // Concatenate ALL blocks of the first matching tag so multi-part
    // responses (object per block, prose between) stay complete.
    for (const lang of languagePatterns) {
      const tagged = blocks.filter((block) => block.tag === lang);
      if (tagged.length > 0) {
        return {
          code: tagged.map((block) => block.content).join("\n\n"),
          language: expectedLanguage,
          extractedFromDelimiters: true,
          confidence: 0.9,
          originalResponse: response,
        };
      }
    }

    // Untagged/other fences: a single block keeps the legacy behavior;
    // multiple blocks concatenate only the AL-like ones.
    let chosen = blocks;
    if (blocks.length > 1) {
      const alLike = expectedLanguage === "al"
        ? blocks.filter((block) => this.AL_LIKENESS_RE.test(block.content))
        : [];
      chosen = alLike.length > 0 ? alLike : blocks.slice(0, 1);
    }

    const code = chosen.map((block) => block.content).join("\n\n");
    const detectedLanguage = this.detectLanguage(code);

    return {
      code,
      language: detectedLanguage === "unknown"
        ? expectedLanguage
        : detectedLanguage,
      extractedFromDelimiters: true,
      confidence: detectedLanguage === expectedLanguage ? 0.8 : 0.6,
      originalResponse: response,
    };
  }

  // Legacy greedy first-opener-to-last-closer extraction. Only used for
  // malformed fencing (odd fence count), where block boundaries are
  // ambiguous and truncating at the first closer would drop real code.
  private static extractFromCodeBlocksGreedy(
    response: string,
    expectedLanguage: "al" | "diff",
    languagePatterns: string[],
  ): ExtractionResult {
    for (const lang of languagePatterns) {
      const pattern = new RegExp(
        `\`\`\`${lang}\\s*\\n([\\s\\S]*)\\n\`\`\``,
        "i",
      );
      const match = response.match(pattern);

      if (match && match[1]) {
        return {
          code: match[1].trim(),
          language: expectedLanguage,
          extractedFromDelimiters: true,
          confidence: 0.9,
          originalResponse: response,
        };
      }
    }

    // Look for any fenced code block
    const genericPattern = /```[\w]*\s*\n([\s\S]*)\n```/;
    const genericMatch = response.match(genericPattern);

    if (genericMatch && genericMatch[1]) {
      const code = genericMatch[1].trim();
      const detectedLanguage = this.detectLanguage(code);

      return {
        code,
        language: detectedLanguage === "unknown"
          ? expectedLanguage
          : detectedLanguage,
        extractedFromDelimiters: true,
        confidence: detectedLanguage === expectedLanguage ? 0.8 : 0.6,
        originalResponse: response,
      };
    }

    return {
      code: "",
      language: expectedLanguage,
      extractedFromDelimiters: false,
      confidence: 0,
      originalResponse: response,
    };
  }

  // Extract from common patterns
  private static extractFromCommonPatterns(
    response: string,
    expectedLanguage: "al" | "diff",
  ): ExtractionResult {
    if (expectedLanguage === "diff") {
      // Look for diff patterns
      const diffLines = response.split("\n").filter((line) =>
        line.startsWith("---") || line.startsWith("+++") ||
        line.startsWith("@@") || line.startsWith("+") ||
        line.startsWith("-") || line.startsWith(" ")
      );

      if (diffLines.length > 3) {
        return {
          code: diffLines.join("\n"),
          language: "diff",
          extractedFromDelimiters: false,
          confidence: 0.7,
          originalResponse: response,
        };
      }
    } else {
      // Look for AL patterns (objects starting with keywords)
      const alPatterns = [
        /^(codeunit|table|page|report|xmlport|enum|interface|controladdin|pageextension|tableextension|reportextension|enumextension)\s+\d+/im,
        /^(procedure|trigger|var|begin|end;)/im,
      ];

      for (const pattern of alPatterns) {
        if (pattern.test(response)) {
          return {
            code: response,
            language: "al",
            extractedFromDelimiters: false,
            confidence: 0.7,
            originalResponse: response,
          };
        }
      }
    }

    return {
      code: "",
      language: expectedLanguage,
      extractedFromDelimiters: false,
      confidence: 0,
      originalResponse: response,
    };
  }

  // Last resort: use whole response
  private static extractWholeResponse(
    response: string,
    expectedLanguage: "al" | "diff",
  ): ExtractionResult {
    const detectedLanguage = this.detectLanguage(response);

    return {
      code: response,
      language: detectedLanguage,
      extractedFromDelimiters: false,
      confidence: detectedLanguage === expectedLanguage ? 0.3 : 0.1,
      originalResponse: response,
    };
  }

  // Detect language from code content
  private static detectLanguage(code: string): "al" | "diff" | "unknown" {
    const lowerCode = code.toLowerCase();

    // Check for diff patterns
    if (
      code.includes("---") && code.includes("+++") &&
      (code.includes("@@") || code.includes("diff --git"))
    ) {
      return "diff";
    }

    // Check for AL patterns
    const alKeywords = [
      "codeunit",
      "table",
      "page",
      "report",
      "xmlport",
      "enum",
      "interface",
      "pageextension",
      "tableextension",
      "reportextension",
      "enumextension",
      "procedure",
      "trigger",
      "var",
      "begin",
      "end;",
      "record",
      "decimal",
    ];

    const alKeywordCount =
      alKeywords.filter((keyword) => lowerCode.includes(keyword)).length;

    if (alKeywordCount >= 2) {
      return "al";
    }

    return "unknown";
  }

  // Clean and validate extracted code
  static cleanCode(code: string, language: "al" | "diff"): string {
    let cleaned = code.trim();

    if (language === "al") {
      // Remove common artifacts from LLM responses
      cleaned = cleaned.replace(/^```[\w]*\s*\n?/, ""); // Remove opening code fence
      cleaned = cleaned.replace(/\n?```\s*$/, ""); // Remove closing code fence
      cleaned = cleaned.replace(/^BEGIN-CODE\s*\n?/i, ""); // Remove custom BEGIN-CODE delimiter
      cleaned = cleaned.replace(/\n?\s*END-CODE\s*$/i, ""); // Remove custom END-CODE delimiter
      cleaned = cleaned.replace(/^Here's the AL code.*?:\s*\n/i, ""); // Remove explanatory text
      cleaned = cleaned.replace(/^The code is.*?:\s*\n/i, ""); // Remove explanatory text

      // Remove lines that are only backticks (formatting artifacts, never valid AL)
      cleaned = cleaned.split("\n")
        .filter((line) => !/^\s*`{3,}\s*$/.test(line))
        .join("\n");

      // Ensure proper line endings
      cleaned = cleaned.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    } else if (language === "diff") {
      // Ensure proper diff format
      if (!cleaned.startsWith("--- ") && !cleaned.startsWith("diff --git")) {
        // Add basic diff headers if missing
        cleaned = `--- a/file.al\n+++ b/file.al\n${cleaned}`;
      }
    }

    return cleaned;
  }

  // Validate extracted code
  static validateCode(code: string, language: "al" | "diff"): string[] {
    const errors: string[] = [];

    if (!code.trim()) {
      errors.push("Empty code extracted");
      return errors;
    }

    if (language === "al") {
      // Basic AL validation
      if (
        !code.includes("begin") && !code.includes("var") &&
        !code.includes("procedure")
      ) {
        errors.push("Code doesn't appear to contain AL structures");
      }

      // Check for obvious text artifacts
      if (
        code.includes("Here's") || code.includes("```") ||
        code.includes("This code")
      ) {
        errors.push("Code contains explanatory text that should be removed");
      }
    } else if (language === "diff") {
      // Basic diff validation
      if (!code.includes("+") && !code.includes("-")) {
        errors.push("Diff doesn't contain any changes");
      }

      if (
        !code.includes("@@") && !code.includes("---") && !code.includes("+++")
      ) {
        errors.push("Diff missing proper headers");
      }
    }

    return errors;
  }
}
