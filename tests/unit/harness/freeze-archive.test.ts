import { assert, assertEquals, assertRejects } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import {
  bind,
  FindingError,
  OperationalError,
  pack,
  TEMP_PREFIX,
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
    secretFiles: [await secret("tok-12345")],
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
  await Deno.writeTextFile(join(root, "leak.txt"), "x tok-12345 y");
  const hit = await assertRejects(
    async () =>
      pack(root, await out(), {
        meta: {},
        secretFiles: [await secret("tok-12345")],
      }),
    Error,
    "leak.txt",
  );
  assert(!hit.message.includes("tok-12345"));
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
  await pack(await tree(), o, {
    meta: {},
    secretFiles: [await secret("tok-12345")],
  });
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
  await pack(await tree(), o, {
    meta: {},
    secretFiles: [await secret("tok-12345")],
  });
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
          secretFiles: [await secret("tok-12345")],
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
  // run 003: secret files are named by position, never by basename
  assert(e.message.includes("secret file #1"));
  assert(!e.message.includes("claude-oauth-token"));
});

Deno.test("a secret value with a trailing LF or CRLF is still found", async () => {
  for (const v of ["tok-12345\n", "tok-12345\r\n"]) {
    const root = await tree();
    await Deno.writeTextFile(join(root, "leak.txt"), "x tok-12345 y");
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

const SCRIPT = fromFileUrl(
  new URL("../../../scripts/harness/freeze-archive.ts", import.meta.url),
);
async function cli(...args: string[]) {
  const r = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", SCRIPT, ...args],
    stdout: "piped",
    stderr: "piped",
    env: { NO_COLOR: "1" },
  }).output();
  const dec = new TextDecoder();
  return {
    code: r.code,
    text: dec.decode(r.stdout) + dec.decode(r.stderr),
  };
}
async function leakRoot(name: string, content: string | Uint8Array) {
  const root = await tree();
  const p = join(root, name);
  await Deno.mkdir(dirname(p), { recursive: true });
  if (typeof content === "string") await Deno.writeTextFile(p, content);
  else await Deno.writeFile(p, content);
  return root;
}
const utf16 = (s: string) =>
  new Uint8Array([...s].flatMap((c) => [c.charCodeAt(0), 0]));
const b64 = (s: string) => btoa(s);
const b64url = (s: string) => btoa(s).replaceAll("+", "-").replaceAll("/", "_");

Deno.test("secret files hold one value per line; each line is searched on its own", async () => {
  const f = await secret("first-secret-1\n\n  second-secret-2  \r\n");
  for (const v of ["first-secret-1", "second-secret-2"]) {
    const e = await assertRejects(
      async () =>
        pack(await leakRoot("leak.txt", `a ${v} b`), await out(), {
          meta: {},
          secretFiles: [f],
        }),
      FindingError,
      "leak.txt",
    );
    assert(!e.message.includes(v));
  }
});

Deno.test("a value shorter than 8 characters and a file with no values are refused as operational failures", async () => {
  const short = await assertRejects(
    async () =>
      pack(await tree(), await out(), {
        meta: {},
        secretFiles: [await secret("long-enough-1\nabc1234\n")],
      }),
    OperationalError,
    "shorter than 8",
  );
  assert(!short.message.includes("abc1234"));
  await assertRejects(
    async () =>
      pack(await tree(), await out(), {
        meta: {},
        secretFiles: [await secret("\n   \r\n\n")],
      }),
    OperationalError,
    "empty secret file",
  );
});

Deno.test("each encoding of a value is found: UTF-16LE, base64 and URL-safe base64 at every alignment, percent-encoding", async () => {
  const v = "tok/se?cr+et=9~>>";
  const f = await secret(v);
  const cases: [string, string | Uint8Array][] = [
    ["utf8", `x${v}y`],
    ["utf16le", utf16(`x${v}y`)],
    ["percent", `q=${encodeURIComponent(v)}&`],
    ["percent-lower", `q=${encodeURIComponent(v).toLowerCase()}&`],
  ];
  for (const pad of ["", "a", "ab"]) {
    cases.push([`b64-${pad.length}`, `h: ${b64(pad + v + "zz")}`]);
    cases.push([`b64url-${pad.length}`, `h: ${b64url(pad + v + "zz")}`]);
  }
  for (const [name, content] of cases) {
    const e = await assertRejects(
      async () =>
        pack(await leakRoot("leak.bin", content), await out(), {
          meta: {},
          secretFiles: [f],
        }),
      FindingError,
      "leak.bin",
      name,
    );
    assert(!e.message.includes(v), name);
  }
});

Deno.test("a value in a file or directory name is a hit and the path is withheld; so is a value in --meta", async () => {
  const v = "pathsecret99";
  const f = await secret(v);
  const e = await assertRejects(
    async () =>
      pack(await leakRoot(join(`d-${v}`, "x.txt"), "clean"), await out(), {
        meta: {},
        secretFiles: [f],
      }),
    FindingError,
    "<path withheld>",
  );
  assert(!e.message.includes(v));
  const m = await assertRejects(
    async () =>
      pack(await tree(), await out(), { meta: { note: v }, secretFiles: [f] }),
    FindingError,
    "--meta",
  );
  assert(!m.message.includes(v));
});

Deno.test("files are scanned in chunks; a value straddling a chunk boundary is found and hashes still verify", async () => {
  const v = "straddle-secret-7";
  const f = await secret(v);
  await assertRejects(
    async () =>
      pack(
        await leakRoot("big.txt", "x".repeat(10) + v + "y".repeat(40)),
        await out(),
        { meta: {}, secretFiles: [f], chunkSize: 16 },
      ),
    FindingError,
    "big.txt",
  );
  const o = await out();
  await pack(await leakRoot("big.txt", "z".repeat(100)), o, {
    meta: {},
    secretFiles: [f],
    chunkSize: 3,
  });
  assertEquals(await verify(o), []);
});

Deno.test("an interrupted publish leaves no outDir and no temp dir", async () => {
  const o = await out();
  await assertRejects(
    async () =>
      pack(await tree(), o, {
        meta: {},
        secretFiles: [await secret("tok-12345")],
        onBeforeRename: () => {
          throw new Error("killed");
        },
      }),
    Error,
    "killed",
  );
  await assertRejects(() => Deno.lstat(o), Deno.errors.NotFound);
  assertEquals(await Array.fromAsync(Deno.readDir(dirname(o))), []);
});

Deno.test("verify refuses a dir whose freeze.json is incomplete", async () => {
  const o = await out();
  await pack(await tree(), o, {
    meta: {},
    secretFiles: [await secret("tok-12345")],
  });
  const t = await Deno.readTextFile(join(o, "freeze.json"));
  await Deno.writeTextFile(join(o, "freeze.json"), t.slice(0, 40));
  assert((await verify(o)).some((x) => x.includes("incomplete freeze.json")));
  await Deno.writeTextFile(join(o, "freeze.json"), '{"v":1}');
  assert((await verify(o)).some((x) => x.includes("incomplete freeze.json")));
});

Deno.test("CLI: a secret hit exits 1 without the value; I/O errors in bind and verify exit 2", async () => {
  const v = "cli-secret-42";
  const hit = await cli(
    "pack",
    await leakRoot("leak.txt", v),
    await out(),
    "--secret-file",
    await secret(v),
  );
  assertEquals(hit.code, 1, hit.text);
  assert(!hit.text.includes(v));
  const o = await out();
  await pack(await tree(), o, {
    meta: {},
    secretFiles: [await secret("tok-12345")],
  });
  const b = await cli("bind", o, join(await Deno.makeTempDir(), "gone.json"));
  assertEquals(b.code, 2, b.text);
  const o2 = await out();
  await Deno.mkdir(join(o2, "freeze.json"), { recursive: true });
  const vr = await cli("verify", o2);
  assertEquals(vr.code, 2, vr.text);
});

Deno.test("percent-encoded values match with mixed-case escapes, in content and in --meta", async () => {
  const v = "tok/se?cr+et=9~>>";
  const f = await secret(v);
  const mixed = encodeURIComponent(v).replace("%2F", "%2f").replace(
    "%3E%3E",
    "%3e%3E",
  );
  assert(mixed !== encodeURIComponent(v) && mixed !== mixed.toLowerCase());
  await assertRejects(
    async () =>
      pack(await leakRoot("leak.bin", `q=${mixed}&`), await out(), {
        meta: {},
        secretFiles: [f],
      }),
    FindingError,
    "leak.bin",
  );
  const m = await assertRejects(
    async () =>
      pack(await tree(), await out(), {
        meta: { url: `https://x/?t=${mixed}` },
        secretFiles: [f],
      }),
    FindingError,
    "--meta",
  );
  assert(!m.message.includes(mixed));
});

Deno.test("verify: a dir where SHA256SUMS, the results tree or a bound file should be is an operational failure (exit 2)", async () => {
  const packed = async () => {
    const o = await out();
    await pack(await tree(), o, {
      meta: {},
      secretFiles: [await secret("tok-12345")],
    });
    return o;
  };
  const o1 = await packed();
  await Deno.remove(join(o1, "SHA256SUMS"));
  await Deno.mkdir(join(o1, "SHA256SUMS"));
  await assertRejects(() => verify(o1), OperationalError);
  assertEquals((await cli("verify", o1)).code, 2);
  const o2 = await packed();
  await Deno.remove(join(o2, "results"), { recursive: true });
  await Deno.writeTextFile(join(o2, "results"), "not a dir");
  await assertRejects(() => verify(o2), OperationalError);
  const o3 = await packed();
  const report = join(await Deno.makeTempDir(), "r.json");
  await Deno.writeTextFile(report, "{}");
  await bind(o3, [report]);
  await Deno.remove(report);
  await Deno.mkdir(report);
  await assertRejects(() => verify(o3), OperationalError);
  assertEquals((await cli("verify", o3)).code, 2);
});

Deno.test("secret-file messages name the file by position, never by basename or path", async () => {
  const good = await secret("good-secret-1");
  const dir = await Deno.makeTempDir();
  const named = async (content: string) => {
    const p = join(dir, `named-${crypto.randomUUID()}`);
    await Deno.writeTextFile(p, content);
    return p;
  };
  const cases: [string, string][] = [
    ["empty", await named("\n")],
    ["short", await named("abc")],
    ["placeholder", await named("REPLACE_ME")],
    ["unreadable", join(dir, "named-gone")],
  ];
  for (const [label, p] of cases) {
    const e = await assertRejects(
      async () =>
        pack(await tree(), await out(), { meta: {}, secretFiles: [good, p] }),
      OperationalError,
      "secret file #2",
      label,
    );
    assert(!e.message.includes("named-"), label);
    assert(!e.message.includes(dir), label);
  }
  const v = "second-file-secret";
  const hit = await assertRejects(
    async () =>
      pack(await leakRoot("leak.txt", v), await out(), {
        meta: {},
        secretFiles: [good, await named(v)],
      }),
    FindingError,
    "secret file #2",
  );
  assert(!hit.message.includes("named-"));
});

Deno.test("the pack temp dir carries a fixed prefix and verify refuses a dir whose name carries it", async () => {
  let seen: string[] = [];
  const o = await out();
  await assertRejects(
    async () =>
      pack(await tree(), o, {
        meta: {},
        secretFiles: [await secret("tok-12345")],
        onBeforeRename: async () => {
          seen = (await Array.fromAsync(Deno.readDir(dirname(o)))).map((e) =>
            e.name
          );
          throw new Error("stop");
        },
      }),
    Error,
    "stop",
  );
  assertEquals(seen.length, 1);
  assert(seen[0]!.startsWith(TEMP_PREFIX), seen[0]);
  const good = await out();
  await pack(await tree(), good, {
    meta: {},
    secretFiles: [await secret("tok-12345")],
  });
  const left = join(dirname(good), `${TEMP_PREFIX}a-1234`);
  await Deno.rename(good, left);
  assert((await verify(left)).some((x) => x.includes("temp dir")));
  assertEquals((await cli("verify", left)).code, 1);
});
