/**
 * Unit tests for the failure analyzer
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  type FailingTask,
  isFixableResult,
  isModelShortcomingResult,
  parseAnalysisResponse,
} from "../../../src/verify/mod.ts";

/**
 * Create a mock FailingTask for testing
 */
function createMockTask(overrides?: Partial<FailingTask>): FailingTask {
  return {
    taskId: "CG-AL-E053",
    difficulty: "easy",
    failureType: "compilation",
    model: "test-model",
    attempt: 1,
    compilationErrors: [],
    output: "COMPILE_ERROR",
    taskYamlPath:
      "U:/Git/CentralGauge/tasks/easy/CG-AL-E053-extend-cardpageid.yml",
    testAlPath: "tests/al/easy/CG-AL-E053.Test.al",
    generatedCodePath:
      "debug/artifacts/CG-AL-E053/test-model/attempt_1/project",
    sessionId: "1234567890",
    ...overrides,
  };
}

Deno.test("parseAnalysisResponse: uses task.taskYamlPath for task_yaml fixes, not LLM path", () => {
  const task = createMockTask({
    taskYamlPath:
      "U:/Git/CentralGauge/tasks/easy/CG-AL-E053-extend-cardpageid.yml",
  });

  // LLM returns wrong path (missing suffix, wrong extension)
  const llmResponse = JSON.stringify({
    outcome: "fixable",
    category: "task_definition_issue",
    description: "Task uses BC 2025 Wave 1 feature",
    affectedFile: "task_yaml",
    fix: {
      filePath: "tasks/easy/CG-AL-E053.yaml", // Wrong! Missing suffix and wrong extension
      description: "Remove CardPageId requirement",
      codeBefore: "old code",
      codeAfter: "new code",
    },
    confidence: "high",
  });

  const result = parseAnalysisResponse(llmResponse, task);

  assertEquals(isFixableResult(result), true);
  if (isFixableResult(result)) {
    // Should use the correct path from task, not the LLM's wrong path
    assertEquals(
      result.fix.filePath,
      "U:/Git/CentralGauge/tasks/easy/CG-AL-E053-extend-cardpageid.yml",
    );
    assertEquals(result.fix.fileType, "task_yaml");
  }
});

Deno.test("parseAnalysisResponse: uses task.testAlPath for test_al fixes, not LLM path", () => {
  const task = createMockTask({
    testAlPath: "tests/al/easy/CG-AL-E053.Test.al",
  });

  // LLM returns wrong path
  const llmResponse = JSON.stringify({
    outcome: "fixable",
    category: "test_logic_bug",
    description: "Test has incorrect assertion",
    affectedFile: "test_al",
    fix: {
      filePath: "tests/CG-AL-E053.Test.al", // Wrong! Missing directory structure
      description: "Fix assertion",
      codeBefore: "old code",
      codeAfter: "new code",
    },
    confidence: "high",
  });

  const result = parseAnalysisResponse(llmResponse, task);

  assertEquals(isFixableResult(result), true);
  if (isFixableResult(result)) {
    // Should use the correct path from task, not the LLM's wrong path
    assertEquals(result.fix.filePath, "tests/al/easy/CG-AL-E053.Test.al");
    assertEquals(result.fix.fileType, "test_al");
  }
});

Deno.test("parseAnalysisResponse: handles missing filePath in LLM response", () => {
  const task = createMockTask({
    taskYamlPath:
      "U:/Git/CentralGauge/tasks/easy/CG-AL-E053-extend-cardpageid.yml",
  });

  // LLM doesn't provide filePath at all
  const llmResponse = JSON.stringify({
    outcome: "fixable",
    category: "task_definition_issue",
    description: "Task uses unsupported feature",
    affectedFile: "task_yaml",
    fix: {
      // No filePath provided
      description: "Remove feature",
      codeBefore: "old code",
      codeAfter: "new code",
    },
    confidence: "medium",
  });

  const result = parseAnalysisResponse(llmResponse, task);

  assertEquals(isFixableResult(result), true);
  if (isFixableResult(result)) {
    // Should still use correct path from task
    assertEquals(
      result.fix.filePath,
      "U:/Git/CentralGauge/tasks/easy/CG-AL-E053-extend-cardpageid.yml",
    );
  }
});

Deno.test("parseAnalysisResponse: parses model_shortcoming correctly", () => {
  const task = createMockTask();

  const llmResponse = JSON.stringify({
    outcome: "model_shortcoming",
    category: "model_knowledge_gap",
    concept: "interface-id-syntax",
    alConcept: "interface-definition",
    description: "Model incorrectly added ID to interface",
    errorCode: "AL0185",
    generatedCode: "interface 50100 'Payment Processor'",
    correctPattern: "interface 'Payment Processor'",
    confidence: "high",
  });

  const result = parseAnalysisResponse(llmResponse, task);

  assertEquals(isModelShortcomingResult(result), true);
  if (isModelShortcomingResult(result)) {
    assertEquals(result.concept, "interface-id-syntax");
    assertEquals(result.alConcept, "interface-definition");
    assertEquals(result.taskId, "CG-AL-E053");
    assertEquals(result.model, "test-model");
  }
});

Deno.test("parseAnalysisResponse: handles markdown-wrapped JSON", () => {
  const task = createMockTask({
    taskYamlPath: "tasks/easy/CG-AL-E001.yml",
  });

  // LLM wraps response in markdown code block
  const llmResponse = `\`\`\`json
{
  "outcome": "fixable",
  "category": "syntax_error",
  "description": "Syntax error in test",
  "affectedFile": "task_yaml",
  "fix": {
    "filePath": "wrong/path.yaml",
    "description": "Fix syntax",
    "codeBefore": "old",
    "codeAfter": "new"
  },
  "confidence": "high"
}
\`\`\``;

  const result = parseAnalysisResponse(llmResponse, task);

  assertEquals(isFixableResult(result), true);
  if (isFixableResult(result)) {
    assertEquals(result.fix.filePath, "tasks/easy/CG-AL-E001.yml");
    assertEquals(result.category, "syntax_error");
  }
});

Deno.test("parseAnalysisResponse: falls back to model_shortcoming on parse failure", () => {
  const task = createMockTask();

  // Invalid JSON response
  const llmResponse = "This is not valid JSON at all";

  const result = parseAnalysisResponse(llmResponse, task);

  assertEquals(isModelShortcomingResult(result), true);
  if (isModelShortcomingResult(result)) {
    assertEquals(result.concept, "parse-failure");
    assertEquals(result.confidence, "low");
  }
});

Deno.test("parseAnalysisResponse: uses correct path based on affectedFile value", () => {
  const task = createMockTask({
    taskYamlPath: "tasks/easy/CG-AL-E001-special.yml",
    testAlPath: "tests/al/easy/CG-AL-E001.Test.al",
  });

  // Test with affectedFile = "test_al"
  const testAlResponse = JSON.stringify({
    outcome: "fixable",
    category: "test_logic_bug",
    description: "Bug in test",
    affectedFile: "test_al",
    fix: {
      filePath: "wrong.al",
      description: "Fix it",
      codeBefore: "a",
      codeAfter: "b",
    },
    confidence: "high",
  });

  const result1 = parseAnalysisResponse(testAlResponse, task);
  assertEquals(isFixableResult(result1), true);
  if (isFixableResult(result1)) {
    assertEquals(result1.fix.filePath, "tests/al/easy/CG-AL-E001.Test.al");
    assertEquals(result1.fix.fileType, "test_al");
  }

  // Test with affectedFile = "task_yaml"
  const taskYamlResponse = JSON.stringify({
    outcome: "fixable",
    category: "task_definition_issue",
    description: "Issue in task",
    affectedFile: "task_yaml",
    fix: {
      filePath: "wrong.yml",
      description: "Fix it",
      codeBefore: "a",
      codeAfter: "b",
    },
    confidence: "high",
  });

  const result2 = parseAnalysisResponse(taskYamlResponse, task);
  assertEquals(isFixableResult(result2), true);
  if (isFixableResult(result2)) {
    assertEquals(result2.fix.filePath, "tasks/easy/CG-AL-E001-special.yml");
    assertEquals(result2.fix.fileType, "task_yaml");
  }
});
