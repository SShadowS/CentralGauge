export const meta = {
  name: 'enrich-task-tags',
  description: 'Content-based facet tagging of all 110 AL benchmark tasks for a discoverability filter, against a controlled vocabulary, with gap detection.',
  phases: [
    { title: 'Tag', detail: 'one agent per ~10-task batch reads specs + assigns facets' },
    { title: 'Reconcile', detail: 'merge + surface vocab gaps' },
  ],
};

const ROOT = 'U:\\Git\\CentralGauge';

// Controlled facet vocabulary — agents assign ONLY these slugs (closed set).
const VOCAB = [
  // object types
  'table','table-extension','page','page-extension','page-customization','report','query','xmlport','codeunit','enum','enum-extension','interface','permissionset',
  // data / schema
  'keys','sift-keys','flowfield','flowfilter','field-validation','table-relation','data-classification','field-properties','auto-increment',
  // reflection
  'recordref','fieldref','keyref','variant','datatransfer',
  // events
  'event-subscriber','event-publisher','integration-event','business-event',
  // errors / transactions
  'errorinfo','try-function','collectible-errors','transaction','locking','telemetry',
  // integration
  'json','xml','http','web-service','api-page','oauth',
  // security
  'permissions','secrettext','encryption','privacy',
  // text / serialization
  'text-builder','base64','encoding','string-formatting','guid','number-formatting',
  // runtime / patterns
  'single-instance','temporary-table','xrec','namespace','generics','collections','triggers',
  // upgrade / lifecycle
  'install','upgrade-tag','obsolete',
  // testing
  'test-codeunit','test-page','test-isolation',
  // UI specifics
  'factbox','system-part','page-action','page-view',
  // numeric
  'rounding','decimal-precision','calculations',
  // version-gated features
  'v15','v16','v17',
];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'task id e.g. CG-AL-M028' },
          facets: { type: 'array', items: { type: 'string' }, description: 'controlled-vocab slugs that apply' },
          suggestedNewTags: { type: 'array', items: { type: 'string' }, description: 'facets this task clearly needs that are NOT in the vocabulary' },
        },
        required: ['id', 'facets', 'suggestedNewTags'],
      },
    },
  },
  required: ['tasks'],
};

// batch the 110 paths into chunks of ~10
const paths = typeof args === 'string' ? JSON.parse(args) : args;
const BATCH = 10;
const batches = [];
for (let i = 0; i < paths.length; i += BATCH) batches.push(paths.slice(i, i + BATCH));
log(`tagging ${paths.length} tasks in ${batches.length} batches of ~${BATCH}`);

phase('Tag');
const vocabStr = VOCAB.join(', ');
const results = await parallel(batches.map((batch, bi) => () => {
  const fileList = batch.map((p) => `${ROOT}\\${p.replaceAll('/', '\\')}`).join('\n');
  return agent(
    `You are tagging Microsoft Dynamics 365 Business Central AL benchmark tasks for a DISCOVERABILITY filter — so a BC developer can find the test that matches THEIR workflow.\n\n` +
    `For EACH task file below, use the Read tool to read it, understand which AL features / APIs / workflow it exercises (from its description and the objects/IDs it asks for), and assign every facet a BC dev would plausibly search by to find this task.\n\n` +
    `ASSIGN ONLY from this CONTROLLED VOCABULARY (use the exact slugs):\n${vocabStr}\n\n` +
    `Rules:\n` +
    `- Assign all that genuinely apply (typically 3-7 per task). Be generous but accurate — a task that defines a secondary/SIFT key gets 'keys'/'sift-keys' even if its title is about something else.\n` +
    `- Use exact slugs from the vocabulary. Do NOT invent variants.\n` +
    `- If a task clearly needs a facet that is NOT in the vocabulary, put that (free-form) under suggestedNewTags so we can expand the vocab. Otherwise leave suggestedNewTags empty.\n` +
    `- The task id is the CG-AL-XXX code (in the file's id: field / filename).\n\n` +
    `Task files (read each):\n${fileList}\n\n` +
    `Return one entry per task.`,
    { label: `tag-batch-${bi + 1}`, phase: 'Tag', schema: SCHEMA, agentType: 'Explore' },
  );
}));

phase('Reconcile');
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
for (const id of Object.keys(taskTags)) for (const f of taskTags[id]) facetFreq[f] = (facetFreq[f] || 0) + 1;

const gaps = Object.entries(gapCounts).sort((a, b) => b[1] - a[1]);
log(`tagged ${tagged} tasks; ${Object.keys(facetFreq).length} distinct facets used; ${gaps.length} suggested vocab gaps`);

return {
  taggedCount: tagged,
  taskTags,
  facetFreq: Object.fromEntries(Object.entries(facetFreq).sort((a, b) => b[1] - a[1])),
  vocabGaps: Object.fromEntries(gaps),
  vocabSize: VOCAB.length,
};
