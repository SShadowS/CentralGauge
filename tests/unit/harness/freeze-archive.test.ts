import { assert, assertEquals, assertRejects } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import {
  bind,
  OperationalError,
  pack,
  verify,
} from "../../../scripts/harness/freeze-archive.ts";

async function tree() {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(join(root, "executions", "c1"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "executions", "c1", "e1.json"),
    '{"a":1}\r\n',
  );
  await Deno.writeTextFile(join(root, "campaigns.json"), "{}");
  return root;
}
async function secret(value: string) {
  const f = join(await Deno.makeTempDir(), "claude-oauth-token");
  await Deno.writeTextFile(f, value);
  return f;
}
const out = async () => join(await Deno.makeTempDir(), "a");

Deno.test("pack then verify is clean; freeze.json holds meta, sums hash and scan count", async () => {
  const o = await out();
  const r = await pack(await tree(), o, {
    meta: { git: "abc" },
    secretFiles: [await secret("tok-123")],
  });
  assertEquals([r.files, await verify(o)], [2, []]);
  const f = JSON.parse(await Deno.readTextFile(join(o, "freeze.json")));
  assertEquals([f.meta.git, f.sums_sha256, f.scan.secret_files, f.scan.hits], [
    "abc",
    r.sumsSha256,
    1,
    0,
  ]);
});

Deno.test("a secret hit fails without printing the value; missing or empty secret files are operational failures", async () => {
  const root = await tree();
  await Deno.writeTextFile(join(root, "leak.txt"), "x tok-123 y");
  const hit = await assertRejects(
    async () =>
      pack(root, await out(), {
        meta: {},
        secretFiles: [await secret("tok-123")],
      }),
    Error,
    "leak.txt",
  );
  assert(!hit.message.includes("tok-123"));
  await assertRejects(
    async () =>
      pack(root, await out(), {
        meta: {},
        secretFiles: [await Deno.makeTempFile()],
      }),
    Error,
    "empty secret file",
  );
  await assertRejects(
    async () =>
      pack(root, await out(), {
        meta: {},
        secretFiles: [join(await Deno.makeTempDir(), "gone")],
      }),
    Error,
    "cannot read secret file",
  );
});

Deno.test("verify names changed, missing, extra files, an edited SHA256SUMS and a changed bound file", async () => {
  const o = await out();
  await pack(await tree(), o, { meta: {}, secretFiles: [await secret("tok")] });
  const report = join(await Deno.makeTempDir(), "r.json");
  await Deno.writeTextFile(report, "{}");
  await bind(o, [report]);
  await Deno.writeTextFile(
    join(o, "results", "executions", "c1", "e1.json"),
    '{"a":1}\n',
  );
  await Deno.remove(join(o, "results", "campaigns.json"));
  await Deno.writeTextFile(join(o, "results", "extra.txt"), "x");
  await Deno.writeTextFile(report, "{ }");
  const p = (await verify(o)).join("\n");
  for (
    const s of [
      "changed: executions/c1/e1.json",
      "missing: campaigns.json",
      "extra: extra.txt",
      "bound file changed",
    ]
  ) assert(p.includes(s), s);
  await Deno.writeTextFile(join(o, "SHA256SUMS"), "tampered\n");
  assert(
    (await verify(o)).some((x) =>
      x.includes("SHA256SUMS does not match freeze.json")
    ),
  );
});

Deno.test("bind is cumulative: reports, then documents; a later call keeps earlier entries; a changed report is caught", async () => {
  const o = await out();
  await pack(await tree(), o, { meta: {}, secretFiles: [await secret("tok")] });
  const dir = await Deno.makeTempDir();
  const report = join(dir, "r.json"), doc = join(dir, "handoff.md");
  await Deno.writeTextFile(report, "{}");
  await Deno.writeTextFile(doc, "# h");
  await bind(o, [report]);
  await bind(o, [doc]);
  await bind(o, [report]); // same hash: no-op
  const d = JSON.parse(await Deno.readTextFile(join(o, "derived.json")));
  assertEquals(
    d.files.map((f: { path: string }) => f.path).sort(),
    [doc, report].sort(),
  );
  assertEquals(await verify(o), []);
  await Deno.writeTextFile(report, "{ }");
  assert(
    (await verify(o)).some((x) =>
      x.includes("bound file changed") && x.includes("r.json")
    ),
  );
  await assertRejects(
    () => bind(o, [report]),
    Error,
    "already bound with another hash",
  );
});

Deno.test({
  name: "a junction in the tree refuses the pack (Windows)",
  ignore: Deno.build.os !== "windows",
  fn: async () => {
    const root = await tree();
    const target = await Deno.makeTempDir();
    const r = await new Deno.Command("cmd", {
      args: ["/c", "mklink", "/J", join(root, "j"), target],
    }).output();
    assert(
      r.success,
      "mklink /J needs no privilege; failing to create it is a test failure, not a skip",
    );
    await assertRejects(
      async () =>
        pack(root, await out(), {
          meta: {},
          secretFiles: [await secret("tok")],
        }),
      Error,
      "link",
    );
  },
});

Deno.test("a REPLACE_ME placeholder secret file is an operational failure, not a clean scan", async () => {
  const root = await tree();
  const e = await assertRejects(
    async () =>
      pack(root, await out(), {
        meta: {},
        secretFiles: [await secret("REPLACE_ME with the token")],
      }),
    OperationalError,
    "placeholder secret file",
  );
  assert(e.message.includes("claude-oauth-token"));
});

Deno.test("a secret value with a trailing LF or CRLF is still found", async () => {
  for (const v of ["tok-123\n", "tok-123\r\n"]) {
    const root = await tree();
    await Deno.writeTextFile(join(root, "leak.txt"), "x tok-123 y");
    await assertRejects(
      async () =>
        pack(root, await out(), { meta: {}, secretFiles: [await secret(v)] }),
      Error,
      "leak.txt",
    );
  }
});

Deno.test("the CLI pack without --secret-file exits 2 and writes nothing", async () => {
  const o = await out();
  const r = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-all",
      fromFileUrl(
        new URL("../../../scripts/harness/freeze-archive.ts", import.meta.url),
      ),
      "pack",
      await tree(),
      o,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(r.code, 2);
  assert(new TextDecoder().decode(r.stdout).includes("--secret-file"));
  await assertRejects(() => Deno.lstat(o), Deno.errors.NotFound);
});
