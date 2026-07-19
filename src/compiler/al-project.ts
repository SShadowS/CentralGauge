import { exists } from "@std/fs";
import { extname, join } from "@std/path";
import { ResourceNotFoundError } from "../errors.ts";
import type { ALProject } from "../container/types.ts";

export class ALProjectManager {
  static async loadProject(projectPath: string): Promise<ALProject> {
    const appJsonPath = join(projectPath, "app.json");

    if (!await exists(appJsonPath)) {
      throw new ResourceNotFoundError(
        `No app.json found in ${projectPath}`,
        "file",
        "app.json",
        { projectPath },
      );
    }

    const appJsonContent = await Deno.readTextFile(appJsonPath);
    let appJson: object;
    try {
      appJson = JSON.parse(appJsonContent);
    } catch (e) {
      throw new ResourceNotFoundError(
        `Malformed app.json in ${projectPath}: ${
          e instanceof Error ? e.message : String(e)
        }`,
        "file",
        "app.json",
        { projectPath },
      );
    }

    const sourceFiles = await this.findFiles(projectPath, [".al"], ["Test"]);
    const testFiles = await this.findFiles(projectPath, [".al"], [], ["Test"]);

    return {
      path: projectPath,
      appJson,
      sourceFiles,
      testFiles,
    };
  }

  static async createProject(
    projectPath: string,
    config: {
      id: string;
      name: string;
      publisher: string;
      version: string;
      platform: string;
      application: string;
      idRanges: Array<{ from: number; to: number }>;
    },
  ): Promise<ALProject> {
    await Deno.mkdir(projectPath, { recursive: true });

    const appJson = {
      id: config.id,
      name: config.name,
      publisher: config.publisher,
      version: config.version,
      brief: "",
      description: "",
      privacyStatement: "",
      EULA: "",
      help: "",
      url: "",
      logo: "",
      dependencies: [],
      screenshots: [],
      platform: config.platform,
      application: config.application,
      idRanges: config.idRanges,
      resourceExposurePolicy: {
        allowDebugging: true,
        allowDownloadingSource: false,
        includeSourceInSymbolFile: false,
      },
      runtime: "15.0",
      features: ["NoImplicitWith"],
    };

    const appJsonPath = join(projectPath, "app.json");
    await Deno.writeTextFile(appJsonPath, JSON.stringify(appJson, null, 2));

    return {
      path: projectPath,
      appJson,
      sourceFiles: [],
      testFiles: [],
    };
  }

  static async validateProject(project: ALProject): Promise<string[]> {
    const issues: string[] = [];

    // Check app.json
    if (!project.appJson) {
      issues.push("Missing app.json");
    } else {
      const required = [
        "id",
        "name",
        "publisher",
        "version",
        "platform",
        "application",
      ];
      for (const field of required) {
        if (!(field in project.appJson)) {
          issues.push(`Missing required field in app.json: ${field}`);
        }
      }
    }

    // Check source files exist
    for (const file of project.sourceFiles) {
      if (!await exists(file)) {
        issues.push(`Source file not found: ${file}`);
      }
    }

    // Check test files exist
    for (const file of project.testFiles) {
      if (!await exists(file)) {
        issues.push(`Test file not found: ${file}`);
      }
    }

    return issues;
  }

  private static async findFiles(
    dir: string,
    extensions: string[],
    excludePatterns: string[] = [],
    includePatterns: string[] = [],
  ): Promise<string[]> {
    const files: string[] = [];

    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile) {
          const fileName = entry.name;
          const filePath = join(dir, fileName);
          const ext = extname(fileName).toLowerCase();

          // Check extension
          if (!extensions.includes(ext)) continue;

          // Check exclude patterns
          if (excludePatterns.some((pattern) => fileName.includes(pattern))) {
            // Only exclude if no include patterns match
            if (
              includePatterns.length === 0 ||
              !includePatterns.some((pattern) => fileName.includes(pattern))
            ) {
              continue;
            }
          }

          // Check include patterns (if specified)
          if (
            includePatterns.length > 0 &&
            !includePatterns.some((pattern) => fileName.includes(pattern))
          ) {
            continue;
          }

          files.push(filePath);
        } else if (entry.isDirectory) {
          // Recursively search subdirectories
          const subFiles = await this.findFiles(
            join(dir, entry.name),
            extensions,
            excludePatterns,
            includePatterns,
          );
          files.push(...subFiles);
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }

    return files.sort();
  }

  static getProjectInfo(project: ALProject): string {
    const app = project.appJson as {
      name?: string;
      version?: string;
      publisher?: string;
    };
    return `${app?.name || "Unknown"} v${app?.version || "0.0.0"} by ${
      app?.publisher || "Unknown"
    }`;
  }

  static async copyProject(
    sourcePath: string,
    destPath: string,
  ): Promise<void> {
    await Deno.mkdir(destPath, { recursive: true });

    // Copy all files recursively
    for await (const entry of Deno.readDir(sourcePath)) {
      const sourceFile = join(sourcePath, entry.name);
      const destFile = join(destPath, entry.name);

      if (entry.isFile) {
        await Deno.copyFile(sourceFile, destFile);
      } else if (entry.isDirectory) {
        await this.copyProject(sourceFile, destFile);
      }
    }
  }
}
