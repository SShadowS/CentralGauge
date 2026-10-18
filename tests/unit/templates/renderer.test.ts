import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { TemplateRenderer } from "../../../src/templates/renderer.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

describe("TemplateRenderer", () => {
  let renderer: TemplateRenderer;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await testTempDir({ prefix: "template-test-" });
    renderer = new TemplateRenderer(tempDir);
  });

  afterEach(async () => {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("constructor", () => {
    it("should use default template directory", () => {
      const defaultRenderer = new TemplateRenderer();
      assert(defaultRenderer instanceof TemplateRenderer);
    });

    it("should accept custom template directory", () => {
      const customRenderer = new TemplateRenderer("/custom/path");
      assert(customRenderer instanceof TemplateRenderer);
    });
  });

  describe("loadTemplate()", () => {
    it("should load template from file", async () => {
      const templateContent = "Hello {{name}}!";
      const templatePath = join(tempDir, "greeting.txt");
      await Deno.writeTextFile(templatePath, templateContent);

      const loaded = await renderer.loadTemplate("greeting.txt");
      assertEquals(loaded, templateContent);
    });

    it("should cache loaded templates", async () => {
      const templateContent = "Cached {{content}}";
      const templatePath = join(tempDir, "cached.txt");
      await Deno.writeTextFile(templatePath, templateContent);

      // First load
      const loaded1 = await renderer.loadTemplate("cached.txt");

      // Delete the file
      await Deno.remove(templatePath);

      // Should still work from cache
      const loaded2 = await renderer.loadTemplate("cached.txt");
      assertEquals(loaded1, loaded2);
    });

    it("should throw error for non-existent template", async () => {
      await assertRejects(
        async () => await renderer.loadTemplate("non-existent.txt"),
        Error,
        "Template not found",
      );
    });
  });

  describe("renderString()", () => {
    it("should replace simple variables", () => {
      const template = "Hello {{name}}, you are {{age}} years old!";
      const context = { name: "Alice", age: 25 };

      const result = renderer.renderString(template, context);
      assertEquals(result, "Hello Alice, you are 25 years old!");
    });

    it("should handle missing variables", () => {
      const template = "Hello {{name}}, welcome to {{place}}!";
      const context = { name: "Bob" };

      const result = renderer.renderString(template, context);
      assertEquals(result, "Hello Bob, welcome to {{place}}!");
    });

    it("should handle different value types", () => {
      const template = "String: {{str}}, Number: {{num}}, Boolean: {{bool}}";
      const context = {
        str: "text",
        num: 42,
        bool: true,
      };

      const result = renderer.renderString(template, context);
      assertEquals(result, "String: text, Number: 42, Boolean: true");
    });

    it("should handle null and undefined values", () => {
      const template = "Null: {{nullVal}}, Undefined: {{undefVal}}";
      const context = {
        nullVal: null,
        undefVal: undefined,
      };

      const result = renderer.renderString(template, context);
      assertEquals(result, "Null: {{nullVal}}, Undefined: {{undefVal}}");
    });

    it("should handle empty template", () => {
      const result = renderer.renderString("", { key: "value" });
      assertEquals(result, "");
    });

    it("should handle template without variables", () => {
      const template = "Just plain text";
      const result = renderer.renderString(template, { key: "value" });
      assertEquals(result, "Just plain text");
    });
  });

  describe("render()", () => {
    it("should load and render template", async () => {
      const templateContent = "Project: {{project}}, Version: {{version}}";
      await Deno.writeTextFile(join(tempDir, "project.txt"), templateContent);

      const result = await renderer.render("project.txt", {
        project: "CentralGauge",
        version: "1.0.0",
      });

      assertEquals(result, "Project: CentralGauge, Version: 1.0.0");
    });
  });

  describe("renderAdvanced()", () => {
    describe("conditionals", () => {
      it("should handle if conditionals", () => {
        const template = "{{#if premium}}You are a premium user!{{/if}}";

        const premiumResult = renderer.renderAdvanced(template, {
          premium: true,
        });
        assertEquals(premiumResult, "You are a premium user!");

        const regularResult = renderer.renderAdvanced(template, {
          premium: false,
        });
        assertEquals(regularResult, "");
      });

      it("should handle unless conditionals", () => {
        const template = "{{#unless loggedIn}}Please log in{{/unless}}";

        const notLoggedIn = renderer.renderAdvanced(template, {
          loggedIn: false,
        });
        assertEquals(notLoggedIn, "Please log in");

        const loggedIn = renderer.renderAdvanced(template, { loggedIn: true });
        assertEquals(loggedIn, "");
      });

      it("should handle nested content in conditionals", () => {
        const template = `{{#if showDetails}}
Name: {{name}}
Age: {{age}}
{{/if}}`;

        const result = renderer.renderAdvanced(template, {
          showDetails: true,
          name: "Charlie",
          age: 30,
        });

        assert(result.includes("Name: Charlie"));
        assert(result.includes("Age: 30"));
      });
    });

    describe("loops", () => {
      it("should handle each loops with arrays", () => {
        const template = "Items: {{#each items}}{{.}}, {{/each}}";
        const context = { items: ["apple", "banana", "orange"] };

        const result = renderer.renderAdvanced(template, context);
        assertEquals(result, "Items: apple, banana, orange, ");
      });

      it("should handle empty arrays", () => {
        const template = "Items: {{#each items}}{{.}}{{/each}}";
        const context = { items: [] };

        const result = renderer.renderAdvanced(template, context);
        assertEquals(result, "Items: ");
      });

      it("should handle non-array values in each", () => {
        const template = "{{#each notArray}}{{.}}{{/each}}";
        const context = { notArray: "string" };

        const result = renderer.renderAdvanced(template, context);
        assertEquals(result, "");
      });
    });

    it("should combine conditionals, loops, and variables", () => {
      const template = `{{#if showList}}
List of {{category}}:
{{#each items}}- {{.}}
{{/each}}
{{/if}}
{{#unless showList}}No items to display{{/unless}}`;

      const withList = renderer.renderAdvanced(template, {
        showList: true,
        category: "fruits",
        items: ["apple", "banana"],
      });

      assert(withList.includes("List of fruits:"));
      assert(withList.includes("- apple"));
      assert(withList.includes("- banana"));
      assert(!withList.includes("No items"));

      const withoutList = renderer.renderAdvanced(template, {
        showList: false,
        category: "fruits",
        items: [],
      });

      assertEquals(withoutList.trim(), "No items to display");
    });
  });

  describe("validateTemplate()", () => {
    it("should validate correct template", () => {
      const template = "Hello {{name}}!";
      const errors = renderer.validateTemplate(template);
      assertEquals(errors.length, 0);
    });

    it("should detect unmatched if blocks", () => {
      const template = "{{#if condition}}Content";
      const errors = renderer.validateTemplate(template);
      assert(errors.length > 0);
      assert(errors.length > 0);
      assert(errors[0]?.includes("Unmatched {{#if}} blocks"));
    });

    it("should detect unmatched unless blocks", () => {
      const template = "{{#unless condition}}Content{{/unless}}{{/unless}}";
      const errors = renderer.validateTemplate(template);
      assert(errors.length > 0);
      assert(errors.length > 0);
      assert(errors[0]?.includes("Unmatched {{#unless}} blocks"));
    });

    it("should detect unmatched each blocks", () => {
      const template = "{{#each items}}{{.}}";
      const errors = renderer.validateTemplate(template);
      assert(errors.length > 0);
      assert(errors.length > 0);
      assert(errors[0]?.includes("Unmatched {{#each}} blocks"));
    });

    it("should validate complex template", () => {
      const template = `{{#if showHeader}}
{{title}}
{{/if}}
{{#each items}}
  {{#unless hidden}}{{.}}{{/unless}}
{{/each}}`;

      const errors = renderer.validateTemplate(template);
      assertEquals(errors.length, 0);
    });
  });

  describe("getRequiredVariables()", () => {
    it("should extract basic variables", () => {
      const template = "Hello {{name}}, your score is {{score}}";
      const vars = renderer.getRequiredVariables(template);

      assertEquals(vars, ["name", "score"]);
    });

    it("should extract conditional variables", () => {
      const template =
        "{{#if premium}}Premium{{/if}} {{#unless trial}}Full{{/unless}}";
      const vars = renderer.getRequiredVariables(template);

      assertEquals(vars, ["premium", "trial"]);
    });

    it("should extract loop variables", () => {
      const template = "{{#each products}}{{.}}{{/each}}";
      const vars = renderer.getRequiredVariables(template);

      assertEquals(vars, ["products"]);
    });

    it("should handle duplicates", () => {
      const template = "{{name}} {{name}} {{#if name}}{{name}}{{/if}}";
      const vars = renderer.getRequiredVariables(template);

      assertEquals(vars, ["name"]);
    });

    it("should extract from complex template", () => {
      const template = `{{title}}
{{#if showDetails}}
  Name: {{name}}
  {{#each tags}}{{.}}{{/each}}
{{/if}}
{{#unless hideFooter}}{{footer}}{{/unless}}`;

      const vars = renderer.getRequiredVariables(template);
      assertEquals(vars, [
        "footer",
        "hideFooter",
        "name",
        "showDetails",
        "tags",
        "title",
      ]);
    });

    it("should ignore special placeholders", () => {
      const template = "{{#each items}}Item: {{.}}{{/each}}";
      const vars = renderer.getRequiredVariables(template);

      assertEquals(vars, ["items"]); // Should not include "."
    });
  });

  describe("clearCache()", () => {
    it("should clear template cache", async () => {
      const templatePath = join(tempDir, "cached.txt");
      await Deno.writeTextFile(templatePath, "Cached content");

      // Load to cache
      await renderer.loadTemplate("cached.txt");

      // Clear cache
      renderer.clearCache();

      // Delete file
      await Deno.remove(templatePath);

      // Should fail now since cache is cleared
      await assertRejects(
        async () => await renderer.loadTemplate("cached.txt"),
        Error,
        "Template not found",
      );
    });
  });
});
