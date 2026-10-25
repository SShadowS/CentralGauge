import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join, resolve } from "@std/path";
import { parseSecretsDirs } from "../../../cli/commands/harness-command.ts";
import {
  checkAccountsSecrets,
  pickAccount,
  recoverInterrupted,
  runCell,
  type SecretAccount,
} from "../../../src/harness/execution.ts";
import {
  ConfigurationError,
  ContainerError,
  ValidationError,
} from "../../../src/errors.ts";
import { ExecutionRecordSchema } from "../../../src/harness/records.ts";
import { loadTask } from "../../../src/harness/task.ts";
import { tempDir } from "./temp-dirs.ts";
import { ccBehavior, cellFor, makeEnv } from "./runtime-fixture.ts";

const abs = (p: string) => resolve(Deno.cwd(), p);
const exists = (p: string) => Deno.stat(p).then(() => true, () => false);

Deno.test("parseSecretsDirs: one plain dir is one unlabelled account", () => {
  assertEquals(parseSecretsDirs(["sec"]), [{ label: null, dir: abs("sec") }]);
});

Deno.test("parseSecretsDirs: label=dir pairs, dirs made absolute", () => {
  assertEquals(parseSecretsDirs(["work=a", "maxpriv2=b/c"]), [
    { label: "work", dir: abs("a") },
    { label: "maxpriv2", dir: abs("b/c") },
  ]);
  assertEquals(parseSecretsDirs(["work=a"]), [
    { label: "work", dir: abs("a") },
  ]);
});

Deno.test("parseSecretsDirs: refuses mixed, bad label, duplicates, plain among many, empty", () => {
  assertThrows(() => parseSecretsDirs(["work=a", "b"]), ValidationError);
  assertThrows(() => parseSecretsDirs(["a", "b"]), ValidationError);
  assertThrows(() => parseSecretsDirs(["Work=a"]), ValidationError);
  assertThrows(() => parseSecretsDirs(["-x=a"]), ValidationError);
  assertThrows(() => parseSecretsDirs(["w=a", "w=b"]), ValidationError);
  assertThrows(() => parseSecretsDirs(["w=a", "x=a"]), ValidationError);
  assertThrows(() => parseSecretsDirs(["w="]), ValidationError);
  assertThrows(() => parseSecretsDirs([]), ValidationError);
});

const two: SecretAccount[] = [
  { label: "work", dir: "A" },
  { label: "maxpriv2", dir: "B" },
];

Deno.test("pickAccount: block index modulo, one account always itself", () => {
  assertEquals(pickAccount(two, 0).label, "work");
  assertEquals(pickAccount(two, 1).label, "maxpriv2");
  assertEquals(pickAccount(two, 2).label, "work");
  assertEquals(pickAccount(two, 2), pickAccount(two, 2));
  const one = [{ label: null, dir: "X" }];
  assertEquals(pickAccount(one, 41).dir, "X");
});

Deno.test("pickAccount: 22 tasks x 3 repeats = 66 blocks give each arm 33/33", () => {
  const arms = ["a", "b", "c"];
  const count = new Map<string, number>();
  for (let index = 0; index < 66; index++) {
    // every arm of a block shares the block's account
    for (const arm of arms) {
      const k = `${arm}/${pickAccount(two, index).label}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  for (const arm of arms) {
    assertEquals(count.get(`${arm}/work`), 33);
    assertEquals(count.get(`${arm}/maxpriv2`), 33);
  }
});

Deno.test("checkAccountsSecrets: a second account dir missing its token fails before any cell", async () => {
  const good = await tempDir();
  const bad = await tempDir();
  await Deno.writeTextFile(join(good, "claude-oauth-token"), "x".repeat(40));
  await checkAccountsSecrets(
    [{ label: "work", dir: good }],
    ["claude-oauth-token"],
  );
  await assertRejects(
    () =>
      checkAccountsSecrets(
        [{ label: "work", dir: good }, { label: "maxpriv2", dir: bad }],
        ["claude-oauth-token"],
      ),
    ConfigurationError,
    "claude-oauth-token",
  );
});

Deno.test("execution record carries account for a labelled run and omits it unlabelled", async () => {
  await using t = await makeEnv();
  const cell = await cellFor(t);
  const [plain] = (await runCell(t.env, cell)).executions;
  assert(plain);
  assert(!("account" in plain));
  await using u = await makeEnv();
  u.env.secretAccounts = [
    { label: "maxpriv2", dir: u.env.secretAccounts[0]!.dir },
  ];
  const [lab] = (await runCell(u.env, await cellFor(u))).executions;
  assertEquals(lab!.account, "maxpriv2");
  ExecutionRecordSchema.parse(lab);
});

Deno.test("R-02 run 002: recovery records the interrupted attempt's own account, whatever command recovers", async () => {
  for (
    const recoverWith of [
      null, // an unlabelled command, e.g. judge-fixture
      "other", // a command with another label at index 0
    ]
  ) {
    await using t = await makeEnv();
    const cell = await cellFor(t);
    t.docker.behavior = async (call, io) => {
      t.docker.lingering.add(call.name);
      return await ccBehavior(join(t.repo.tasksDir, "HX-001"), "correct")(
        call,
        io,
      );
    };
    const dir = t.env.secretAccounts[0]!.dir;
    await assertRejects(
      () =>
        runCell({ ...t.env, secretAccounts: [{ label: "work", dir }] }, cell),
      ContainerError,
      "termination not confirmed",
    );
    t.docker.lingering.clear();
    const [e] = await recoverInterrupted(
      { ...t.env, secretAccounts: [{ label: recoverWith, dir }] },
      loadTask,
    );
    assertEquals(e!.account, "work", `recovered by ${recoverWith}`);
  }
});

Deno.test("R-02 run 002: a real cell checks every supplied account dir before anything runs", async () => {
  await using t = await makeEnv();
  const cell = await cellFor(t);
  // The cell's own account (block 0: work) is complete; only the other dir lacks the token.
  t.env.secretAccounts = [
    { label: "work", dir: t.env.secretAccounts[0]!.dir },
    { label: "private", dir: await tempDir() },
  ];
  // Like any missing operator secret: this cell's setup_failed, nothing run or reserved.
  const e = (await runCell(t.env, cell)).executions[0]!;
  assertEquals(e.termination, "setup_failed");
  assertEquals(t.docker.runs.length, 0);
  assert(!await exists(t.env.credentialLedger!), "no slot reserved");
});
