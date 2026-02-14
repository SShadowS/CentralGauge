/**
 * Theme definitions for benchmark report subpages
 * @module src/tasks/themes
 */

/**
 * Definition of a benchmark theme that groups tasks by AL code category
 */
export interface ThemeDefinition {
  /** URL-safe identifier used in filenames and links */
  slug: string;
  /** Human-readable display name */
  name: string;
  /** What this theme covers */
  description: string;
  /** Matches metadata.category in task YAML */
  category: string;
}

/**
 * The 7 benchmark themes that group tasks by AL code area
 */
export const THEMES: ThemeDefinition[] = [
  {
    slug: "data-modeling",
    name: "Data Modeling",
    category: "data-modeling",
    description:
      "Tables, fields, enums, keys, FlowFields, CalcFormulas, and table extensions",
  },
  {
    slug: "user-interface",
    name: "User Interface",
    category: "user-interface",
    description: "Pages, page extensions, reports, XMLports, and API pages",
  },
  {
    slug: "business-logic",
    name: "Business Logic",
    category: "business-logic",
    description: "Codeunits, calculations, algorithms, and string manipulation",
  },
  {
    slug: "interfaces-events",
    name: "Interfaces & Events",
    category: "interfaces-events",
    description:
      "Interface definitions, implementations, event publishers and subscribers",
  },
  {
    slug: "data-exchange",
    name: "Data Exchange",
    category: "data-exchange",
    description:
      "JSON handling, HTTP integration, XMLport I/O, and external APIs",
  },
  {
    slug: "error-handling",
    name: "Error Handling & Safety",
    category: "error-handling",
    description:
      "TryFunction, ErrorInfo, SecretText, permissions, and security attributes",
  },
  {
    slug: "advanced-patterns",
    name: "Advanced AL Patterns",
    category: "advanced-patterns",
    description:
      "RecordRef, FieldRef, Queries, SingleInstance, Fluent API, and modern collections",
  },
];

/**
 * Look up a theme by its category value
 */
export function getThemeByCategory(
  category: string,
): ThemeDefinition | undefined {
  return THEMES.find((t) => t.category === category);
}

/**
 * Look up a theme by its slug
 */
export function getThemeBySlug(slug: string): ThemeDefinition | undefined {
  return THEMES.find((t) => t.slug === slug);
}

/**
 * Static mapping from task ID to primary theme category.
 * Used as a fallback when result data doesn't include category metadata
 * (backward compatibility with older result files).
 */
export const TASK_THEME_MAP: Record<string, string> = {
  "CG-AL-E001": "data-modeling",
  "CG-AL-E002": "user-interface",
  "CG-AL-E003": "data-modeling",
  "CG-AL-E004": "data-modeling",
  "CG-AL-E005": "business-logic",
  "CG-AL-E006": "user-interface",
  "CG-AL-E007": "user-interface",
  "CG-AL-E008": "interfaces-events",
  "CG-AL-E009": "data-exchange",
  "CG-AL-E010": "interfaces-events",
  "CG-AL-E031": "data-modeling",
  "CG-AL-E032": "interfaces-events",
  "CG-AL-E045": "data-modeling",
  "CG-AL-E050": "business-logic",
  "CG-AL-E051": "business-logic",
  "CG-AL-E052": "business-logic",
  "CG-AL-E053": "user-interface",
  "CG-AL-M001": "user-interface",
  "CG-AL-M002": "business-logic",
  "CG-AL-M003": "data-modeling",
  "CG-AL-M004": "user-interface",
  "CG-AL-M005": "data-exchange",
  "CG-AL-M006": "data-modeling",
  "CG-AL-M007": "user-interface",
  "CG-AL-M008": "business-logic",
  "CG-AL-M009": "interfaces-events",
  "CG-AL-M010": "business-logic",
  "CG-AL-M020": "data-exchange",
  "CG-AL-M021": "data-exchange",
  "CG-AL-M022": "data-exchange",
  "CG-AL-M023": "advanced-patterns",
  "CG-AL-M088": "business-logic",
  "CG-AL-M112": "data-modeling",
  "CG-AL-H001": "business-logic",
  "CG-AL-H002": "data-modeling",
  "CG-AL-H003": "advanced-patterns",
  "CG-AL-H004": "data-modeling",
  "CG-AL-H005": "advanced-patterns",
  "CG-AL-H006": "advanced-patterns",
  "CG-AL-H007": "error-handling",
  "CG-AL-H008": "error-handling",
  "CG-AL-H009": "business-logic",
  "CG-AL-H010": "interfaces-events",
  "CG-AL-H011": "advanced-patterns",
  "CG-AL-H013": "business-logic",
  "CG-AL-H014": "data-exchange",
  "CG-AL-H015": "interfaces-events",
  "CG-AL-H016": "error-handling",
  "CG-AL-H017": "advanced-patterns",
  "CG-AL-H018": "advanced-patterns",
  "CG-AL-H019": "error-handling",
  "CG-AL-H020": "advanced-patterns",
  "CG-AL-H021": "interfaces-events",
  "CG-AL-H022": "advanced-patterns",
  "CG-AL-H023": "advanced-patterns",
  "CG-AL-H205": "interfaces-events",
};
