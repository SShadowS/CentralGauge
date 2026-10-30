import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { taskSummary } from "../../src/lib/server/task-summaries";

async function seed(): Promise<void> {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',2,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_categories(id,slug,name) VALUES (1,'easy','Easy'),(2,'hard','Hard')`,
    ),
    env.DB.prepare(
      `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json)
       VALUES ('ts','easy/a','hash-a','easy',1,'{"id":"easy/a","goal":"Add a function"}'),
              ('ts','hard/b','hash-b','hard',2,'{"id":"hard/b","goal":"Refactor module"}')`,
    ),
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7',47)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts,max_tokens,prompt_version,bc_version) VALUES ('s',0.0,2,8192,'v1','Cronus28')`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'r',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
  ]);
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      "r1",
      "ts",
      1,
      "s",
      "rig",
      "2026-04-01T00:00:00Z",
      "2026-04-01T01:00:00Z",
      "completed",
      "claimed",
      "v1",
      "sig",
      "2026-04-01T00:00:00Z",
      1,
      new Uint8Array([0]),
    )
    .run();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
       VALUES ('r1','easy/a',1,1,1.0,1,3,3,1200,300),('r1','hard/b',1,0,0.0,1,3,0,0,0)`,
    ),
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await seed();
});

describe("GET /api/v1/tasks", () => {
  it("lists tasks in current set by default", async () => {
    const res = await SELF.fetch("https://x/api/v1/tasks");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{
        id: string;
        difficulty: string;
        content_hash: string;
        category: { slug: string; name: string };
      }>;
      next_cursor: string | null;
    };
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("easy/a");
    expect(body.data[0].difficulty).toBe("easy");
    expect(body.data[0].category.slug).toBe("easy");
    expect(body.data[0].content_hash).toBe("hash-a");
    expect(body.next_cursor).toBeNull();
  });

  it("respects limit + paginates via cursor", async () => {
    const res1 = await SELF.fetch("https://x/api/v1/tasks?limit=1");
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as {
      data: Array<{ id: string }>;
      next_cursor: string | null;
    };
    expect(body1.data).toHaveLength(1);
    expect(body1.next_cursor).not.toBeNull();

    const res2 = await SELF.fetch(
      `https://x/api/v1/tasks?limit=1&cursor=${encodeURIComponent(
        body1.next_cursor!,
      )}`,
    );
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as {
      data: Array<{ id: string }>;
      next_cursor: string | null;
    };
    expect(body2.data).toHaveLength(1);
    expect(body2.data[0].id).not.toBe(body1.data[0].id);
    expect(body2.data[0].id).toBe("hard/b");
    expect(body2.next_cursor).toBeNull();
  });

  it("rejects invalid limit", async () => {
    for (const val of ["0", "101", "-1", "abc"]) {
      const res = await SELF.fetch(`https://x/api/v1/tasks?limit=${val}`);
      expect(res.status, `limit=${val} should 400`).toBe(400);
    }
  });
});

describe("GET /api/v1/tasks — filters", () => {
  it("?difficulty=hard returns only hard tasks", async () => {
    const res = await SELF.fetch("https://x/api/v1/tasks?difficulty=hard");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ difficulty: string }> };
    for (const row of body.data) expect(row.difficulty).toBe("hard");
  });

  it("?category=schema-design returns only that category", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/tasks?category=schema-design",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ category: { slug: string } | null }>;
    };
    for (const row of body.data) {
      expect(row.category).not.toBeNull();
      expect(row.category!.slug).toBe("schema-design");
    }
  });

  it("combines ?difficulty= and ?category=", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/tasks?difficulty=easy&category=schema-design",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ difficulty: string; category: { slug: string } | null }>;
    };
    for (const row of body.data) {
      expect(row.difficulty).toBe("easy");
      expect(row.category?.slug).toBe("schema-design");
    }
  });

  it("rejects invalid difficulty with 400", async () => {
    const res = await SELF.fetch("https://x/api/v1/tasks?difficulty=trivial");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/invalid_difficulty/);
  });
});

describe("GET /api/v1/tasks — tags", () => {
  it("returns facet tags per task", async () => {
    // Seed tags and task_tags for the task 'easy/a' (already in current set via seed())
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tags(id,slug,name) VALUES (1,'keys','Keys'),(2,'table','Table')`,
      ),
      env.DB.prepare(
        `INSERT INTO task_tags(task_set_hash,task_id,tag_id) VALUES ('ts','easy/a',1),('ts','easy/a',2)`,
      ),
    ]);
    const res = await SELF.fetch("https://x/api/v1/tasks?set=current&_cb=tags");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; tags: string[] }>;
    };
    const t1 = body.data.find((r) => r.id === "easy/a");
    expect(t1).toBeDefined();
    expect(t1!.tags).toEqual(["keys", "table"]);
  });

  it("returns empty tags array for an untagged task", async () => {
    // No task_tags inserted — 'hard/b' has no tags
    const res = await SELF.fetch(
      "https://x/api/v1/tasks?set=current&_cb=notags",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; tags: string[] }>;
    };
    const t2 = body.data.find((r) => r.id === "hard/b");
    expect(t2).toBeDefined();
    expect(t2!.tags).toEqual([]);
  });
});

describe("GET /api/v1/tasks — ?tag filter", () => {
  // Seed: t1 (easy/a) has tags 'keys' + 'table', t2 (hard/b) has tag 'table' only,
  // t3 (medium/c) exists with no tags.
  async function seedTagFilter() {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json)
         VALUES ('ts','medium/c','hash-c','easy',1,'{"id":"medium/c","goal":"Third task"}')`,
      ),
      env.DB.prepare(
        `INSERT INTO tags(id,slug,name) VALUES (1,'keys','Keys'),(2,'table','Table')`,
      ),
      env.DB.prepare(
        `INSERT INTO task_tags(task_set_hash,task_id,tag_id)
         VALUES ('ts','easy/a',1),('ts','easy/a',2),('ts','hard/b',2)`,
      ),
    ]);
  }

  it("filters tasks by a single ?tag (AND base case)", async () => {
    await seedTagFilter();
    const res = await SELF.fetch(
      "https://x/api/v1/tasks?set=current&tag=keys&_cb=f1",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    const ids = body.data.map((r) => r.id);
    expect(ids).toEqual(["easy/a"]); // only easy/a has 'keys'
  });

  it("filters by multiple ?tag with AND semantics", async () => {
    await seedTagFilter();
    const res = await SELF.fetch(
      "https://x/api/v1/tasks?set=current&tag=keys&tag=table&_cb=f2",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    const ids = body.data.map((r) => r.id);
    expect(ids).toEqual(["easy/a"]); // only easy/a has BOTH keys AND table; hard/b has only table
  });

  it("unknown tag yields no rows", async () => {
    await seedTagFilter();
    const res = await SELF.fetch(
      "https://x/api/v1/tasks?set=current&tag=nope&_cb=f3",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data).toEqual([]);
  });
});

describe("GET /api/v1/tasks/:id", () => {
  it("returns task detail + solved-by matrix", async () => {
    const res = await SELF.fetch("https://x/api/v1/tasks/easy/a");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      difficulty: string;
      content_hash: string;
      task_set_hash: string;
      category: { slug: string; name: string };
      manifest: unknown;
      solved_by: Array<{
        model_slug: string;
        attempt_1_passed: number;
        runs_total: number;
        avg_score: number;
        avg_tokens_in: number;
        avg_tokens_out: number;
      }>;
    };
    expect(body.id).toBe("easy/a");
    expect(body.difficulty).toBe("easy");
    expect(body.content_hash).toBe("hash-a");
    expect(body.category.slug).toBe("easy");
    expect(body.solved_by).toHaveLength(1);
    expect(body.solved_by[0].model_slug).toBe("sonnet-4.7");
    expect(body.solved_by[0].attempt_1_passed).toBe(1);
    expect(body.solved_by[0].runs_total).toBe(1);
    expect(body.solved_by[0].avg_score).toBeCloseTo(1.0, 5);
    expect(body.solved_by[0].avg_tokens_in).toBe(1200);
    expect(body.solved_by[0].avg_tokens_out).toBe(300);
  });

  it("returns 404 for unknown task", async () => {
    const res = await SELF.fetch("https://x/api/v1/tasks/easy/nonexistent");
    expect(res.status).toBe(404);
  });

  // Real X185 description, as the loader parses it (sha must match the catalog entry).
  const X185_DESCRIPTION = "The application exchanges figures with an external service, imports amounts from a nightly feed, settles travel claims, and consolidates readings across the companies on the database. Codeunit \"CG X092 Wire Format\" converts values to and from the text form that service exchanges documents in: ToWireDecimal writes an amount as a leading \"-\" for a negative value, plain digits and a single \".\" before any fractional part, with nothing marking the thousands; ToWireDate writes a date; FromWireDecimal and FromWireDate read such text back into the value it stands for. They produce and accept the same text on every server. Codeunit \"CG X076 Import Job\"'s ImportBatch calls \"CG X076 Legacy Importer\"'s ImportLine once per line of a batch and returns how many lines were imported: a well-formed, non-negative amount text produces one \"CG X076 Legacy Amount\" row for its entry code and counts as imported, while a badly formed or negative one reports failure and leaves no row behind. ParseAmount converts a well-formed amount text; TryParseAmount reports whether one can be converted. Codeunit \"CG X114 Allowance Calc\" derives a travel allowance from a claim's away-time in minutes through CalculateAllowance, stores that amount onto the \"CG X114 Travel Claim\" record through RecalculateClaim, and classifies the same away-time into the bands the away-time statistics report uses through OvertimeBandOf. The amount a claim is paid and the band it is reported under describe the same outcome for any away-time. Codeunit \"CG X162 Consolidator\"'s CollectReadings walks every company on the database and copies each company's \"CG X162 Meter Reading\" rows into one \"CG X162 Collected Reading\" list, each collected row carrying the quantity read and the \"Source Company\" it was read in. Since the last release, figures this application hands over have stopped agreeing with the records they were built from, and nobody reporting it has been able to say where it starts. Fix the application so every contract above holds.";

  it("returns the catalog summary for a summarised task and null otherwise", async () => {
    await env.DB.prepare(
      `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json)
       VALUES ('ts','CG-AL-X185','hash-x','hard',2,?),
              ('ts','CG-AL-E001','hash-e','easy',1,'{"id":"CG-AL-E001"}')`,
    )
      .bind(
        JSON.stringify({ id: "CG-AL-X185", description: X185_DESCRIPTION }),
      )
      .run();
    const x = (await (await SELF.fetch("https://x/api/v1/tasks/CG-AL-X185"))
      .json()) as { summary: string | null };
    expect(x.summary).toBe(
      await taskSummary("CG-AL-X185", X185_DESCRIPTION),
    );
    expect(x.summary).not.toBeNull();
    const e = (await (await SELF.fetch("https://x/api/v1/tasks/CG-AL-E001"))
      .json()) as { summary: string | null };
    expect(e.summary).toBeNull();
  });

  it("returns a null summary when the served description is not the one it was written for", async () => {
    await env.DB.prepare(
      `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json)
       VALUES ('ts','CG-AL-X185','hash-x','hard',2,?)`,
    )
      .bind(
        JSON.stringify({
          id: "CG-AL-X185",
          description: X185_DESCRIPTION + " An edited sentence.",
        }),
      )
      .run();
    const x = (await (await SELF.fetch("https://x/api/v1/tasks/CG-AL-X185"))
      .json()) as { summary: string | null };
    expect(x.summary).toBeNull();
  });
});
