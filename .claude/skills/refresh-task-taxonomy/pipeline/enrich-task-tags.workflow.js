export const meta = {
  name: "enrich-task-tags",
  description:
    "Content-based facet tagging of all AL benchmark tasks (every prompt format) for a discoverability filter, against a controlled mechanism/invariant/environment vocabulary, with gap detection.",
  phases: [
    {
      title: "Tag",
      detail: "one agent per ~10-task batch reads specs + assigns facets",
    },
    { title: "Reconcile", detail: "merge + surface vocab gaps" },
  ],
};

// `args` is either a JSON array of manifest paths (relative to the checkout) or
// `{ root, paths, batch }` — `root` overrides the checkout (a git worktree, for
// example), `batch` the tasks-per-agent count.
const rawArgs = typeof args === "string" ? JSON.parse(args) : args;
const ROOT = (!Array.isArray(rawArgs) && rawArgs.root) ||
  "U:\\Git\\CentralGauge";

// Controlled facet vocabulary — agents assign ONLY these slugs (closed set).
// Kept in lockstep with MECHANISM_VOCAB / INVARIANT_VOCAB / ENVIRONMENT_VOCAB
// in site/src/lib/shared/taxonomy-schema.ts (tests/unit/taxonomy/merge.test.ts
// asserts the two stay equal). Surface (object-type) facets are NOT enriched
// here — build-taxonomy.ts derives those from the manifest's own tags.
const VOCAB = [
  // mechanism — which BC runtime semantic the task turns on
  "tryfunction-write-rollback",
  "commit-scope",
  "error-flow",
  "filter-key-semantics",
  "filter-group-state",
  "temporary-record",
  "xrec-trigger-state",
  "event-binding",
  "event-order",
  "validation-trigger",
  "decimal-precision",
  "culture-format-roundtrip",
  "serialization-encoding",
  "company-scope",
  "permission-check",
  "flowfield-sift",
  "sql-cost-scaling",
  "single-instance-state",
  "recordref-reflection",
  "upgrade-datatransfer",
  "record-locking-concurrency",
  // invariant — which domain contract the hidden tests grade
  "largest-remainder-allocation",
  "reversal-conservation",
  "exact-total",
  "inclusive-boundary",
  "idempotent-rebuild",
  "company-isolation",
  "roundtrip-fidelity",
  "bounded-sql-cost",
  // environment — which execution requirement applies
  "multi-company",
  "culture-sensitive",
  "test-permissions",
];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "task id e.g. CG-AL-M028" },
          facets: {
            type: "array",
            items: { type: "string" },
            description: "controlled-vocab slugs that apply",
          },
          suggestedNewTags: {
            type: "array",
            items: { type: "string" },
            description:
              "facets this task clearly needs that are NOT in the vocabulary",
          },
        },
        required: ["id", "facets", "suggestedNewTags"],
      },
    },
  },
  required: ["tasks"],
};

// batch the paths into chunks (default ~10 per agent)
const paths = Array.isArray(rawArgs) ? rawArgs : rawArgs.paths;
const BATCH = (!Array.isArray(rawArgs) && Number(rawArgs.batch)) || 10;
const batches = [];
for (let i = 0; i < paths.length; i += BATCH) {
  batches.push(paths.slice(i, i + BATCH));
}
log(`tagging ${paths.length} tasks in ${batches.length} batches of ~${BATCH}`);

phase("Tag");
const vocabStr = VOCAB.join(", ");
const results = await parallel(batches.map((batch, bi) => () => {
  const fileList = batch.map((p) => `${ROOT}\\${p.replaceAll("/", "\\")}`).join(
    "\n",
  );
  return agent(
    `You are tagging Microsoft Dynamics 365 Business Central AL benchmark tasks for a DISCOVERABILITY filter — so a BC developer can find the test that matches THEIR workflow.\n\n` +
      `For EACH task file below, use the Read tool to read it, understand which AL features / APIs / workflow it exercises (from its description and the objects/IDs it asks for), and ASSIGN ONLY mechanism, invariant and environment facets: which Business Central runtime semantic the task turns on, which domain contract the hidden tests grade, and which execution requirement applies. Do NOT assign object-type surfaces (tables, pages, codeunits): those come from the manifest. A build-from-spec task grades invariants (boundaries, exact totals) as much as a diagnose task does; tag it the same way.\n\n` +
      `ASSIGN ONLY from this CONTROLLED VOCABULARY (use the exact slugs):\n${vocabStr}\n\n` +
      `Rules:\n` +
      `- Assign all that genuinely apply (typically 1-4 per task: usually one mechanism, one invariant, and an environment facet only when the task truly requires multi-company, culture-sensitive, or permission-restricted execution). Be generous but accurate — a task whose hidden tests check an exact-total invariant gets 'exact-total' even if its title is about something else.\n` +
      `- Use exact slugs from the vocabulary. Do NOT invent variants.\n` +
      `- If a task clearly needs a facet that is NOT in the vocabulary, put that (free-form) under suggestedNewTags so we can expand the vocab. Otherwise leave suggestedNewTags empty.\n` +
      `- The task id is the CG-AL-XXX code (in the file's id: field / filename).\n` +
      `- Diagnose-format tasks (prompt_template diagnose.md / diagnose-objects.md / diagnose-contract.md) deliberately do NOT say what is wrong. For those, also read the starter application under ${ROOT}\\tasks\\starter\\<id>\\ and, when it exists, the reference solution under ${ROOT}\\reference\\solutions\\<id>\\; the mechanism facet is whatever runtime semantic the difference between starter and reference turns on, and the invariant facet is what the corrected code restores. For a composite (metadata.donors present) skip this: its facets are derived from its donors by the pipeline, so return an empty facets list for it.\n\n` +
      `Task files (read each):\n${fileList}\n\n` +
      `Return one entry per task.`,
    {
      label: `tag-batch-${bi + 1}`,
      phase: "Tag",
      schema: SCHEMA,
      agentType: "Explore",
    },
  );
}));

phase("Reconcile");
const taskTags = {};
const gapCounts = {};
let tagged = 0;
for (const r of results) {
  if (!r || !r.tasks) continue;
  for (const t of r.tasks) {
    taskTags[t.id] = (t.facets || []).filter((f) => VOCAB.includes(f)).sort();
    tagged++;
    for (const g of (t.suggestedNewTags || [])) {
      const k = g.toLowerCase().trim();
      if (k) gapCounts[k] = (gapCounts[k] || 0) + 1;
    }
  }
}

// facet frequency across all tasks
const facetFreq = {};
for (const id of Object.keys(taskTags)) {
  for (const f of taskTags[id]) facetFreq[f] = (facetFreq[f] || 0) + 1;
}

const gaps = Object.entries(gapCounts).sort((a, b) => b[1] - a[1]);
log(
  `tagged ${tagged} tasks; ${
    Object.keys(facetFreq).length
  } distinct facets used; ${gaps.length} suggested vocab gaps`,
);

return {
  taggedCount: tagged,
  taskTags,
  facetFreq: Object.fromEntries(
    Object.entries(facetFreq).sort((a, b) => b[1] - a[1]),
  ),
  vocabGaps: Object.fromEntries(gaps),
  vocabSize: VOCAB.length,
};
