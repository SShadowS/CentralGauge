import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  computeTaskSetHash,
  resolveCurrentTaskSetHash,
} from "../../../src/ingest/catalog/task-set-hash.ts";

async function makeProjectRoot(): Promise<string> {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(`${root}/tasks/easy`, { recursive: true });
  await Deno.mkdir(`${root}/tests/al/easy`, { recursive: true });
  await Deno.mkdir(`${root}/tests/al/dependencies/CG-AL-E001`, {
    recursive: true,
  });
  await Deno.mkdir(`${root}/tests/al/support-files/CG-AL-E001`, {
    recursive: true,
  });
  return root;
}

Deno.test("hash is deterministic and order-independent across YAML edits", async () => {
  const root = await makeProjectRoot();
  try {
    await Deno.writeTextFile(`${root}/tasks/easy/b.yml`, "id: B");
    await Deno.writeTextFile(`${root}/tasks/easy/a.yml`, "id: A");
    const h1 = await computeTaskSetHash(root);
    const h2 = await computeTaskSetHash(root);
    assertEquals(h1, h2);

    await Deno.writeTextFile(`${root}/tasks/easy/a.yml`, "id: A2");
    const h3 = await computeTaskSetHash(root);
    assertNotEquals(h1, h3);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("hash ignores non-yml files inside tasks/", async () => {
  const root = await makeProjectRoot();
  try {
    await Deno.writeTextFile(`${root}/tasks/easy/a.yml`, "id: A");
    const h1 = await computeTaskSetHash(root);
    await Deno.writeTextFile(`${root}/tasks/easy/readme.md`, "docs");
    const h2 = await computeTaskSetHash(root);
    assertEquals(h1, h2);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("hash changes when AL test codeunit is edited", async () => {
  const root = await makeProjectRoot();
  try {
    await Deno.writeTextFile(`${root}/tasks/easy/a.yml`, "id: A");
    await Deno.writeTextFile(
      `${root}/tests/al/easy/CG-AL-E001.Test.al`,
      "codeunit 80001 Test { }",
    );
    const h1 = await computeTaskSetHash(root);
    await Deno.writeTextFile(
      `${root}/tests/al/easy/CG-AL-E001.Test.al`,
      "codeunit 80001 Test { procedure P() begin end; }",
    );
    const h2 = await computeTaskSetHash(root);
    assertNotEquals(h1, h2);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("hash changes when prereq app file is edited", async () => {
  const root = await makeProjectRoot();
  try {
    await Deno.writeTextFile(`${root}/tasks/easy/a.yml`, "id: A");
    await Deno.writeTextFile(
      `${root}/tests/al/dependencies/CG-AL-E001/app.json`,
      `{"id":"x","name":"prereq","version":"1.0.0.0"}`,
    );
    const h1 = await computeTaskSetHash(root);
    await Deno.writeTextFile(
      `${root}/tests/al/dependencies/CG-AL-E001/app.json`,
      `{"id":"x","name":"prereq","version":"1.0.0.1"}`,
    );
    const h2 = await computeTaskSetHash(root);
    assertNotEquals(h1, h2);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("hash changes when support file is edited", async () => {
  const root = await makeProjectRoot();
  try {
    await Deno.writeTextFile(`${root}/tasks/easy/a.yml`, "id: A");
    await Deno.writeTextFile(
      `${root}/tests/al/support-files/CG-AL-E001/Report.rdl`,
      "<Report version=1/>",
    );
    const h1 = await computeTaskSetHash(root);
    await Deno.writeTextFile(
      `${root}/tests/al/support-files/CG-AL-E001/Report.rdl`,
      "<Report version=2/>",
    );
    const h2 = await computeTaskSetHash(root);
    assertNotEquals(h1, h2);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("hash skips .alpackages/, output/, *.app, cache_*.json", async () => {
  const root = await makeProjectRoot();
  try {
    await Deno.writeTextFile(`${root}/tasks/easy/a.yml`, "id: A");
    await Deno.writeTextFile(
      `${root}/tests/al/dependencies/CG-AL-E001/app.json`,
      "{}",
    );
    const baseline = await computeTaskSetHash(root);

    // Add build artifacts that should be ignored
    await Deno.mkdir(
      `${root}/tests/al/dependencies/CG-AL-E001/.alpackages`,
      { recursive: true },
    );
    await Deno.writeTextFile(
      `${root}/tests/al/dependencies/CG-AL-E001/.alpackages/Microsoft_App.app`,
      "binary",
    );
    await Deno.writeTextFile(
      `${root}/tests/al/dependencies/CG-AL-E001/.alpackages/cache_AppInfo.json`,
      `{"v":1}`,
    );
    await Deno.mkdir(`${root}/tests/al/dependencies/CG-AL-E001/output`, {
      recursive: true,
    });
    await Deno.writeTextFile(
      `${root}/tests/al/dependencies/CG-AL-E001/output/built.app`,
      "compiled",
    );
    // Also a top-level *.app
    await Deno.writeTextFile(
      `${root}/tests/al/dependencies/CG-AL-E001/Prereq.app`,
      "stray",
    );

    const afterArtifacts = await computeTaskSetHash(root);
    assertEquals(
      afterArtifacts,
      baseline,
      "build artifacts must not affect hash",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("hash is identical regardless of walker discovery order", async () => {
  const root1 = await makeProjectRoot();
  const root2 = await makeProjectRoot();
  try {
    // Write the same logical content, in opposite filesystem order
    await Deno.writeTextFile(`${root1}/tasks/easy/z.yml`, "z");
    await Deno.writeTextFile(`${root1}/tasks/easy/a.yml`, "a");
    await Deno.writeTextFile(`${root2}/tasks/easy/a.yml`, "a");
    await Deno.writeTextFile(`${root2}/tasks/easy/z.yml`, "z");
    assertEquals(
      await computeTaskSetHash(root1),
      await computeTaskSetHash(root2),
    );
  } finally {
    await Deno.remove(root1, { recursive: true });
    await Deno.remove(root2, { recursive: true });
  }
});

Deno.test("hash treats binary content with NUL bytes unambiguously", async () => {
  // Regression for the previous concat-with-NUL framing: two file sets that
  // would have collided under "<rel>\0<bytes>\0" must now hash differently.
  const root1 = await makeProjectRoot();
  const root2 = await makeProjectRoot();
  try {
    await Deno.writeTextFile(`${root1}/tasks/easy/a.yml`, "id: A");
    await Deno.writeTextFile(`${root2}/tasks/easy/a.yml`, "id: A");
    // Set 1: one file containing NUL bytes that look like a framing boundary.
    const sneaky = new Uint8Array([
      ...new TextEncoder().encode("evil"),
      0,
      ...new TextEncoder().encode("tests/al/easy/extra.al"),
      0,
      ...new TextEncoder().encode("payload"),
    ]);
    await Deno.writeFile(
      `${root1}/tests/al/support-files/CG-AL-E001/blob.bin`,
      sneaky,
    );
    // Set 2: same NUL-framed appearance but split across two real files.
    await Deno.writeFile(
      `${root2}/tests/al/support-files/CG-AL-E001/blob.bin`,
      new TextEncoder().encode("evil"),
    );
    await Deno.writeTextFile(
      `${root2}/tests/al/easy/extra.al`,
      "payload",
    );
    assertNotEquals(
      await computeTaskSetHash(root1),
      await computeTaskSetHash(root2),
    );
  } finally {
    await Deno.remove(root1, { recursive: true });
    await Deno.remove(root2, { recursive: true });
  }
});

Deno.test("hash is stable when tests/al subdir is missing", async () => {
  // Older repo state or an integration tmpdir may have tasks/ but no tests/al/.
  // Hashing must not throw.
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/tasks/easy`, { recursive: true });
    await Deno.writeTextFile(`${root}/tasks/easy/a.yml`, "id: A");
    const h = await computeTaskSetHash(root);
    assert(h.length === 64, "expected 32-byte hex SHA-256");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("resolveCurrentTaskSetHash returns 'current' sentinel when project missing", async () => {
  const tmp = await Deno.makeTempDir();
  await Deno.remove(tmp, { recursive: true });
  // tmp now points to a non-existent path
  const out = await resolveCurrentTaskSetHash(tmp);
  assertEquals(out, "current");
});

Deno.test("resolveCurrentTaskSetHash returns real hash when project exists", async () => {
  const root = await makeProjectRoot();
  try {
    await Deno.writeTextFile(`${root}/tasks/easy/a.yml`, "id: A");
    const out = await resolveCurrentTaskSetHash(root);
    assertEquals(out.length, 64);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
