import {
  assertAlmostEquals,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import {
  estimateCost,
  loadPricingBook,
  type ModelTokens,
  type PricingBook,
} from "../../../src/harness/pricing.ts";

const BOOK: PricingBook = {
  at: "2026-10-05T00:00:00.000Z",
  models: {
    "claude-sonnet-5": {
      slug: "anthropic/claude-sonnet-5",
      pricing_version: "2026-09-25",
      input: 2,
      output: 10,
      cache_read: 0.2,
      cache_write_5m: 2.5,
      cache_write_1h: 4,
      cache_write_1h_derived: true,
    },
    "zero-cache": {
      slug: "x/zero-cache",
      pricing_version: "v1",
      input: 1,
      output: 1,
      cache_read: 0,
      cache_write_5m: 0,
      cache_write_1h: null,
      cache_write_1h_derived: false,
    },
  },
};
const T = (over: Partial<ModelTokens> = {}): ModelTokens => ({
  model: "claude-sonnet-5",
  requests: null,
  input: 10,
  cache_read: 120646,
  cache_write_5m: 22276,
  cache_write_1h: 6792,
  cache_write_unknown: 0,
  output: 2181,
  reasoning: 694,
  problems: [],
  ...over,
});

const MODELS_YML = `- slug: anthropic/claude-sonnet-5
  api_model_id: claude-sonnet-5
  family: claude
  display_name: Claude Sonnet 5
- slug: openai/gpt-x
  api_model_id: gpt-x
  family: gpt
  display_name: GPT X
`;

async function catalog(models: string, pricing: string): Promise<string> {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(join(dir, "models.yml"), models);
  await Deno.writeTextFile(join(dir, "pricing.yml"), pricing);
  return dir;
}

const PRICE = (version: string, slug: string, from: string, extra = "") =>
  `- pricing_version: '${version}'
  model_slug: ${slug}
  effective_from: '${from}'
  effective_until: null
  input_per_mtoken: 1
  output_per_mtoken: 4
  cache_read_per_mtoken: 0.1
  cache_write_per_mtoken: 0
${extra}`;
const GPT_X = PRICE("v1", "openai/gpt-x", "2026-01-01T00:00:00.000Z");
const AT = new Date("2026-10-05T00:00:00.000Z");

Deno.test("loadPricingBook: newest entry effective at the run time; 1-hour write derived for anthropic/* only", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(
    join(dir, "models.yml"),
    `- slug: anthropic/claude-sonnet-5
  api_model_id: claude-sonnet-5
  family: claude
  display_name: Claude Sonnet 5
- slug: openai/gpt-x
  api_model_id: gpt-x
  family: gpt
  display_name: GPT X
`,
  );
  await Deno.writeTextFile(
    join(dir, "pricing.yml"),
    `- pricing_version: '2026-09-08'
  model_slug: anthropic/claude-sonnet-5
  effective_from: '2026-09-08T00:00:00.000Z'
  effective_until: null
  input_per_mtoken: 2
  output_per_mtoken: 10
  cache_read_per_mtoken: 0
  cache_write_per_mtoken: 0
- pricing_version: '2026-09-25'
  model_slug: anthropic/claude-sonnet-5
  effective_from: '2026-09-25T00:00:00.000Z'
  effective_until: null
  input_per_mtoken: 2
  output_per_mtoken: 10
  cache_read_per_mtoken: 0.2
  cache_write_per_mtoken: 2.5
- pricing_version: '2026-12-01'
  model_slug: anthropic/claude-sonnet-5
  effective_from: '2026-12-01T00:00:00.000Z'
  effective_until: null
  input_per_mtoken: 3
  output_per_mtoken: 15
  cache_read_per_mtoken: 0.3
  cache_write_per_mtoken: 3.75
- pricing_version: 'v1'
  model_slug: openai/gpt-x
  effective_from: '2026-01-01T00:00:00.000Z'
  effective_until: null
  input_per_mtoken: 1
  output_per_mtoken: 4
  cache_read_per_mtoken: 0.1
  cache_write_per_mtoken: 0
`,
  );
  const book = await loadPricingBook(
    dir,
    new Date("2026-10-05T00:00:00.000Z"),
  );
  const s5 = book.models["claude-sonnet-5"]!;
  assertEquals([
    s5.pricing_version,
    s5.cache_write_5m,
    s5.cache_write_1h,
    s5.cache_write_1h_derived,
  ], ["2026-09-25", 2.5, 4, true]);
  assertEquals(book.models["gpt-x"]!.cache_write_1h, null);
});

Deno.test("loadPricingBook: malformed YAML, unknown keys, bad rates and bad dates fail naming the file", async () => {
  const cases: [string, string, string][] = [
    [MODELS_YML, "- pricing_version: [unclosed\n", "pricing.yml"],
    [MODELS_YML, GPT_X + "  surprise: 1\n", "pricing.yml"],
    [
      MODELS_YML,
      GPT_X.replace("input_per_mtoken: 1", "input_per_mtoken: .inf"),
      "pricing.yml",
    ],
    [
      MODELS_YML,
      GPT_X.replace("input_per_mtoken: 1", "input_per_mtoken: -1"),
      "pricing.yml",
    ],
    [
      MODELS_YML,
      GPT_X.replace("input_per_mtoken: 1", "input_per_mtoken: '1'"),
      "pricing.yml",
    ],
    [MODELS_YML, PRICE("v1", "openai/gpt-x", "not-a-date"), "pricing.yml"],
    [
      MODELS_YML,
      GPT_X.replace(
        "effective_until: null",
        "effective_until: '2025-01-01T00:00:00.000Z'",
      ),
      "pricing.yml",
    ],
    [MODELS_YML, "not: a list\n", "pricing.yml"],
    [MODELS_YML + "  extra_key: x\n", GPT_X, "models.yml"],
  ];
  for (const [models, pricing, file] of cases) {
    const dir = await catalog(models, pricing);
    const err = await assertRejects(
      () => loadPricingBook(dir, AT),
      ValidationError,
    );
    assertStringIncludes(err.message, join(dir, file));
  }
});

Deno.test("loadPricingBook: a missing file and duplicate api ids fail naming the file", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(join(dir, "models.yml"), MODELS_YML);
  const missing = await assertRejects(
    () => loadPricingBook(dir, AT),
    ValidationError,
  );
  assertStringIncludes(missing.message, join(dir, "pricing.yml"));
  const dup = await catalog(
    MODELS_YML + `- slug: openai/gpt-y
  api_model_id: gpt-x
  family: gpt
  display_name: GPT Y
`,
    GPT_X,
  );
  const e = await assertRejects(
    () => loadPricingBook(dup, AT),
    ValidationError,
    "gpt-x",
  );
  assertStringIncludes(e.message, join(dup, "models.yml"));
});

Deno.test("loadPricingBook: two entries equally effective are ambiguous; effective_until is exclusive", async () => {
  const amb = await catalog(
    MODELS_YML,
    GPT_X + PRICE("v2", "openai/gpt-x", "2026-01-01T00:00:00.000Z"),
  );
  const e = await assertRejects(
    () => loadPricingBook(amb, AT),
    ValidationError,
    "ambiguous",
  );
  assertStringIncludes(e.message, join(amb, "pricing.yml"));
  const ended = await catalog(
    MODELS_YML,
    GPT_X.replace(
      "effective_until: null",
      "effective_until: '2026-10-05T00:00:00.000Z'",
    ),
  );
  assertEquals((await loadPricingBook(ended, AT)).models["gpt-x"], undefined);
});

Deno.test("loadPricingBook: the real catalog loads with finite rates", async () => {
  const dir = fromFileUrl(new URL("../../../site/catalog", import.meta.url));
  const book = await loadPricingBook(dir, new Date());
  for (const [id, p] of Object.entries(book.models)) {
    for (
      const r of [
        p.input,
        p.output,
        p.cache_read,
        p.cache_write_5m,
        p.cache_write_1h ?? 0,
      ]
    ) {
      assertEquals(Number.isFinite(r) && r >= 0, true, id);
    }
    assertEquals(p.cache_write_1h_derived, p.slug.startsWith("anthropic/"), id);
  }
});

Deno.test("estimateCost: priced by logged TTL, per model", () => {
  const r = estimateCost([T()], BOOK);
  assertAlmostEquals(
    r.cost_usd!,
    (10 * 2 + 120646 * 0.2 + 22276 * 2.5 + 6792 * 4 + 2181 * 10) / 1e6,
    1e-12,
  );
  assertEquals(
    r.pricing_snapshot,
    "anthropic/claude-sonnet-5@2026-09-25(1h=2x input)",
  );
  assertEquals([
    r.per_model[0]!.tokens_cache_write,
    r.per_model[0]!.tokens_out,
    r.per_model[0]!.tokens_reasoning,
  ], [29068, 2181, 694]);
});

Deno.test("estimateCost: unknown TTL, a missing usage field, an unknown model, a zero or missing rate give null with a reason", () => {
  const ttl = estimateCost([
    T({ cache_write_5m: 0, cache_write_1h: 0, cache_write_unknown: 29068 }),
  ], BOOK);
  assertEquals([ttl.cost_usd, ttl.missing], [null, [
    "claude-sonnet-5: cache write TTL unknown (29068 tokens)",
  ]]);
  const field = estimateCost([T({ problems: ["outputTokens missing"] })], BOOK);
  assertEquals([field.cost_usd, field.missing], [null, [
    "claude-sonnet-5: outputTokens missing",
  ]]);
  const unknown = estimateCost([T({ model: "nope" })], BOOK);
  assertEquals([unknown.cost_usd, unknown.missing], [null, [
    "nope: not in the pricing book",
  ]]);
  const zero = estimateCost([
    T({ model: "zero-cache", cache_write_5m: 0, cache_write_1h: 0 }),
  ], BOOK);
  assertEquals(zero.missing, ["zero-cache: cache_read rate is 0"]);
  const noHour = estimateCost([
    T({ model: "zero-cache", cache_read: 0, cache_write_5m: 0 }),
  ], BOOK);
  assertEquals(noHour.missing, ["zero-cache: cache_write_1h rate is unknown"]);
  const fine = estimateCost([
    T({
      model: "zero-cache",
      input: 1_000_000,
      cache_read: 0,
      cache_write_5m: 0,
      cache_write_1h: 0,
      output: 0,
    }),
  ], BOOK);
  assertEquals(fine.cost_usd, 1);
});

Deno.test("estimateCost: no usage, bad token counts, prototype keys, duplicates and bad rates give null with a reason", () => {
  assertEquals(estimateCost([], BOOK), {
    cost_usd: null,
    pricing_snapshot: null,
    per_model: [],
    missing: ["no model usage reported"],
  });
  for (const bad of [NaN, Infinity, -1, 1.5]) {
    const r = estimateCost([T({ output: bad })], BOOK);
    assertEquals([r.cost_usd, r.missing], [null, [
      `claude-sonnet-5: output tokens not a non-negative integer (${bad})`,
    ]]);
    assertEquals(r.per_model[0]!.cost_usd, null);
  }
  assertEquals(estimateCost([T({ model: "constructor" })], BOOK).missing, [
    "constructor: not in the pricing book",
  ]);
  assertEquals(estimateCost([T(), T()], BOOK).missing, [
    "claude-sonnet-5: duplicate usage entry",
  ]);
  const nan: PricingBook = {
    ...BOOK,
    models: {
      "claude-sonnet-5": { ...BOOK.models["claude-sonnet-5"]!, output: NaN },
    },
  };
  assertEquals(estimateCost([T()], nan).missing, [
    "claude-sonnet-5: output rate is invalid (NaN)",
  ]);
});

Deno.test("estimateCost: a null priced token kind, or reasoning above output, gives null with a reason", () => {
  const kinds = [
    "input",
    "cache_read",
    "cache_write_5m",
    "cache_write_1h",
    "cache_write_unknown",
    "output",
  ] as const;
  for (const k of kinds) {
    const r = estimateCost([
      T({ [k]: null } as unknown as Partial<ModelTokens>),
    ], BOOK);
    assertEquals([r.cost_usd, r.missing], [null, [
      `claude-sonnet-5: ${k} tokens not a non-negative integer (null)`,
    ]]);
  }
  assertEquals(
    estimateCost([T({ requests: null, reasoning: null })], BOOK).missing,
    [],
  );
  const over = estimateCost([T({ output: 100, reasoning: 101 })], BOOK);
  assertEquals([over.cost_usd, over.missing], [null, [
    "claude-sonnet-5: reasoning tokens (101) exceed output tokens (100)",
  ]]);
});

Deno.test("loadPricingBook: a price for a model not in models.yml and an invalid date fail loudly", async () => {
  const orphan = await catalog(
    MODELS_YML,
    GPT_X + PRICE("v1", "openai/ghost", "2026-01-01T00:00:00.000Z"),
  );
  const e = await assertRejects(
    () => loadPricingBook(orphan, AT),
    ValidationError,
    "openai/ghost",
  );
  assertStringIncludes(e.message, join(orphan, "pricing.yml"));
  const ok = await catalog(MODELS_YML, GPT_X);
  await assertRejects(
    () => loadPricingBook(ok, new Date("nope")),
    ValidationError,
    "invalid",
  );
});

Deno.test("estimateCost: the total and snapshot do not depend on usage order", () => {
  const a = T();
  const b = T({
    model: "zero-cache",
    cache_read: 0,
    cache_write_5m: 0,
    cache_write_1h: 0,
    input: 333_333,
    output: 777_777,
  });
  const x = estimateCost([a, b], BOOK);
  const y = estimateCost([b, a], BOOK);
  assertEquals(x.cost_usd, y.cost_usd);
  assertEquals(
    x.pricing_snapshot,
    "anthropic/claude-sonnet-5@2026-09-25(1h=2x input);x/zero-cache@v1",
  );
  assertEquals(y.pricing_snapshot, x.pricing_snapshot);
});
