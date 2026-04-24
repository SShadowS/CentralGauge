import { assertEquals, assertNotEquals } from "@std/assert";
import { computeTaskSetHash } from "../../../src/ingest/catalog/task-set-hash.ts";

Deno.test("task-set hash is deterministic and order-independent", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tmp}/b-task.yml`, "id: B\nbody: banana");
    await Deno.writeTextFile(`${tmp}/a-task.yml`, "id: A\nbody: apple");
    const h1 = await computeTaskSetHash(tmp);
    const h2 = await computeTaskSetHash(tmp);
    assertEquals(h1, h2);

    await Deno.writeTextFile(`${tmp}/a-task.yml`, "id: A\nbody: apricot");
    const h3 = await computeTaskSetHash(tmp);
    assertNotEquals(h1, h3);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("task-set hash is identical regardless of walker order", async () => {
  const tmp1 = await Deno.makeTempDir();
  const tmp2 = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tmp1}/z.yml`, "one");
    await Deno.writeTextFile(`${tmp1}/a.yml`, "two");
    await Deno.writeTextFile(`${tmp2}/a.yml`, "two");
    await Deno.writeTextFile(`${tmp2}/z.yml`, "one");
    assertEquals(
      await computeTaskSetHash(tmp1),
      await computeTaskSetHash(tmp2),
    );
  } finally {
    await Deno.remove(tmp1, { recursive: true });
    await Deno.remove(tmp2, { recursive: true });
  }
});

Deno.test("task-set hash ignores non-yml files", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tmp}/a.yml`, "task");
    const h1 = await computeTaskSetHash(tmp);
    await Deno.writeTextFile(`${tmp}/readme.md`, "docs");
    const h2 = await computeTaskSetHash(tmp);
    assertEquals(h1, h2);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
