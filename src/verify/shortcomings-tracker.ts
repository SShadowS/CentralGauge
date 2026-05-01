/**
 * Tracks per-model knowledge gaps/shortcomings
 * Deduplicates by concept - one entry per AL concept with list of affected tasks
 */

import { exists } from "@std/fs";
import type {
  ModelShortcomingEntry,
  ModelShortcomingResult,
  ModelShortcomingsFile,
} from "./types.ts";

/**
 * Tracker for model shortcomings
 * Maintains per-model JSON files with deduplicated concept entries
 */
export class ShortcomingsTracker {
  private shortcomingsDir: string;
  private cache: Map<string, ModelShortcomingsFile> = new Map();
  private modified: Set<string> = new Set();

  constructor(shortcomingsDir: string) {
    this.shortcomingsDir = shortcomingsDir;
  }

  /**
   * Load existing shortcomings for a model
   */
  async load(model: string): Promise<ModelShortcomingsFile> {
    // Check cache first
    if (this.cache.has(model)) {
      return this.cache.get(model)!;
    }

    const filePath = this.getFilePath(model);

    if (await exists(filePath)) {
      try {
        const content = await Deno.readTextFile(filePath);
        const data = JSON.parse(content) as ModelShortcomingsFile;
        this.cache.set(model, data);
        return data;
      } catch {
        // If file is corrupted, start fresh
      }
    }

    // Create new file structure
    const newFile: ModelShortcomingsFile = {
      model,
      lastUpdated: new Date().toISOString(),
      shortcomings: [],
    };
    this.cache.set(model, newFile);
    return newFile;
  }

  /**
   * Add a shortcoming for a model
   * Deduplicates by alConcept - merges taskId into existing entry
   */
  async addShortcoming(
    model: string,
    result: ModelShortcomingResult,
  ): Promise<void> {
    const file = await this.load(model);

    // Find existing entry by alConcept
    const existing = file.shortcomings.find(
      (s) => s.alConcept === result.alConcept,
    );

    if (existing) {
      // Update existing entry
      if (!existing.affectedTasks.includes(result.taskId)) {
        existing.affectedTasks.push(result.taskId);
        existing.occurrences++;
      }
      // Merge error codes
      if (result.errorCode && !existing.errorCodes.includes(result.errorCode)) {
        existing.errorCodes.push(result.errorCode);
      }
    } else {
      // Create new entry. The first analyzer call's slug wins — entries are
      // append-only-friendly (the slug never changes after the first write,
      // matching the canonical-registry invariant).
      const newEntry: ModelShortcomingEntry = {
        concept: result.concept,
        alConcept: result.alConcept,
        description: result.description,
        correctPattern: result.correctPattern,
        incorrectPattern: result.generatedCode,
        errorCodes: result.errorCode ? [result.errorCode] : [],
        affectedTasks: [result.taskId],
        firstSeen: new Date().toISOString(),
        occurrences: 1,
        concept_slug_proposed: result.concept_slug_proposed,
        concept_slug_existing_match: result.concept_slug_existing_match,
        similarity_score: result.similarity_score,
      };
      file.shortcomings.push(newEntry);
    }

    file.lastUpdated = new Date().toISOString();
    this.modified.add(model);
  }

  /**
   * Get all shortcomings for a model
   */
  async getByModel(model: string): Promise<ModelShortcomingEntry[]> {
    const file = await this.load(model);
    return file.shortcomings;
  }

  /**
   * Get shortcomings count for a model
   */
  async getCount(model: string): Promise<number> {
    const file = await this.load(model);
    return file.shortcomings.length;
  }

  /**
   * Get total occurrences for a model
   */
  async getTotalOccurrences(model: string): Promise<number> {
    const file = await this.load(model);
    return file.shortcomings.reduce((sum, s) => sum + s.occurrences, 0);
  }

  /**
   * Save modified shortcomings to disk
   */
  async save(): Promise<void> {
    // Ensure directory exists
    await Deno.mkdir(this.shortcomingsDir, { recursive: true });

    for (const model of this.modified) {
      const file = this.cache.get(model);
      if (!file) continue;

      const filePath = this.getFilePath(model);
      await Deno.writeTextFile(
        filePath,
        JSON.stringify(file, null, 2),
      );
    }

    this.modified.clear();
  }

  /**
   * Save shortcomings for a specific model
   */
  async saveModel(model: string): Promise<void> {
    const file = this.cache.get(model);
    if (!file) return;

    await Deno.mkdir(this.shortcomingsDir, { recursive: true });

    const filePath = this.getFilePath(model);
    await Deno.writeTextFile(
      filePath,
      JSON.stringify(file, null, 2),
    );

    this.modified.delete(model);
  }

  /**
   * Get file path for a model's shortcomings file
   */
  private getFilePath(model: string): string {
    // Sanitize model name for filesystem
    const sanitized = model.replace(/[\/\\:*?"<>|]/g, "_");
    return `${this.shortcomingsDir}/${sanitized}.json`;
  }

  /**
   * Generate a summary report of all tracked models
   */
  async generateReport(): Promise<
    Map<string, {
      totalConcepts: number;
      totalOccurrences: number;
      topConcepts: string[];
    }>
  > {
    const report = new Map<string, {
      totalConcepts: number;
      totalOccurrences: number;
      topConcepts: string[];
    }>();

    // List all model files
    try {
      for await (const entry of Deno.readDir(this.shortcomingsDir)) {
        if (!entry.isFile || !entry.name.endsWith(".json")) continue;

        const model = entry.name.replace(".json", "");
        const file = await this.load(model);

        // Sort by occurrences to get top concepts
        const sortedShortcomings = [...file.shortcomings].sort(
          (a, b) => b.occurrences - a.occurrences,
        );

        report.set(model, {
          totalConcepts: file.shortcomings.length,
          totalOccurrences: file.shortcomings.reduce(
            (sum, s) => sum + s.occurrences,
            0,
          ),
          topConcepts: sortedShortcomings.slice(0, 5).map((s) => s.concept),
        });
      }
    } catch {
      // Directory may not exist yet
    }

    return report;
  }

  /**
   * Check if a concept is already tracked for a model
   */
  async hasShortcoming(model: string, alConcept: string): Promise<boolean> {
    const file = await this.load(model);
    return file.shortcomings.some((s) => s.alConcept === alConcept);
  }

  /**
   * Get all tracked models
   */
  async getAllModels(): Promise<string[]> {
    const models: string[] = [];

    try {
      for await (const entry of Deno.readDir(this.shortcomingsDir)) {
        if (!entry.isFile || !entry.name.endsWith(".json")) continue;
        models.push(entry.name.replace(".json", ""));
      }
    } catch {
      // Directory may not exist yet
    }

    return models;
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cache.clear();
    this.modified.clear();
  }
}
