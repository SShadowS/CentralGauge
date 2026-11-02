import { assert, assertEquals, assertThrows } from "@std/assert";
import { ConfigurationError } from "../../../src/errors.ts";
import {
  CODEX_AUTH_FILE,
  codexExpiryProblem,
  parseCodexAuth,
  releasedCodexAuth,
  withCredentialForms,
} from "../../../src/harness/codex-auth.ts";
import { publishRedacted, redactText } from "../../../src/harness/sandbox.ts";
import { codexAuthText, FAKE_CODEX } from "./codex-fixture.ts";

const IN_2H = () => Date.now() + 2 * 3600_000;

Deno.test("parseCodexAuth: exactly one openai-codex oauth entry; every refusal names no value", () => {
  const a = parseCodexAuth(codexAuthText(1_900_000_000_000));
  assertEquals(a, { ...FAKE_CODEX, expires: 1_900_000_000_000 });
  const e = { type: "oauth", ...FAKE_CODEX, expires: 1_900_000_000_000 };
  const bad: string[] = [
    "not json",
    "[]",
    JSON.stringify({}),
    JSON.stringify({ "openai-codex": e, openrouter: { type: "api_key" } }),
    JSON.stringify({ anthropic: e }),
    codexAuthText(1, { type: "api_key" }),
    codexAuthText(1, { extra: "x" }),
    codexAuthText(Number.NaN),
    JSON.stringify({ "openai-codex": { ...e, expires: "1900000000000" } }),
    codexAuthText(1, { access: 42 }),
    codexAuthText(1, { refresh: "short" }),
    codexAuthText(1, { accountId: "has space 0123456789abcdef" }),
    codexAuthText(1, { access: 'quote"0123456789abcdef' }),
  ];
  for (const text of bad) {
    const err = assertThrows(
      () => parseCodexAuth(text),
      ConfigurationError,
      CODEX_AUTH_FILE,
    );
    for (const v of Object.values(FAKE_CODEX)) {
      assert(!err.message.includes(v), `${text}: ${err.message}`);
    }
  }
});

Deno.test("withCredentialForms: the codex file's inner access, refresh and accountId are secret values too", () => {
  const whole = codexAuthText(IN_2H());
  const values = [{ name: CODEX_AUTH_FILE, value: whole }, {
    name: "backend-token",
    value: "b".repeat(64),
  }];
  const forms = withCredentialForms(values);
  assertEquals(forms.slice(0, 2), values);
  assertEquals(
    forms.slice(2).map((f) => f.value).sort(),
    Object.values(FAKE_CODEX).sort(),
  );
  assert(forms.slice(2).every((f) => f.name === CODEX_AUTH_FILE));
  // Other secret files are untouched.
  assertEquals(withCredentialForms([values[1]!]), [values[1]!]);
  const text = `Bearer ${FAKE_CODEX.access} acct ${FAKE_CODEX.accountId} ` +
    `rt ${FAKE_CODEX.refresh}`;
  const r = redactText(text, forms);
  for (const v of Object.values(FAKE_CODEX)) assert(!r.text.includes(v));
  assertEquals(r.count, 3);
  assert(r.text.includes(`[REDACTED:${CODEX_AUTH_FILE}]`));
});

Deno.test("withCredentialForms: published bytes lose the inner values in UTF-8, UTF-16LE and a cut tail", async () => {
  const forms = withCredentialForms([{
    name: CODEX_AUTH_FILE,
    value: codexAuthText(IN_2H()),
  }]);
  const dir = await Deno.makeTempDir();
  const u16 = (s: string) =>
    new Uint8Array(new Uint16Array([...s].map((c) => c.charCodeAt(0))).buffer);
  const enc = new TextEncoder();
  const src = `${dir}/raw.log`;
  const cut = FAKE_CODEX.refresh.slice(0, 20);
  await Deno.writeFile(
    src,
    new Uint8Array([
      ...enc.encode(`a ${FAKE_CODEX.access} b `),
      ...u16(FAKE_CODEX.accountId),
      ...enc.encode(` c ${cut}`),
    ]),
  );
  const dest = `${dir}/out/raw.log`;
  const r = await publishRedacted([{ src, dest }], forms);
  const out = new TextDecoder("latin1").decode(await Deno.readFile(dest));
  assert(!out.includes(FAKE_CODEX.access));
  assert(
    !out.includes(new TextDecoder("latin1").decode(u16(FAKE_CODEX.accountId))),
  );
  assert(!out.includes(cut));
  assertEquals(r.count, 3);
});

Deno.test("codexExpiryProblem: refuses a token that expires before the timeout plus 15 minutes", () => {
  const now = Date.UTC(2026, 9, 1, 12);
  const a = parseCodexAuth(codexAuthText(now + 45 * 60_000));
  assertEquals(codexExpiryProblem(a, 30, now), null);
  const p = codexExpiryProblem(a, 31, now)!;
  assert(p.includes("pi auth print-bearer-token --provider openai-codex"), p);
  assert(p.includes(CODEX_AUTH_FILE), p);
  for (const v of Object.values(FAKE_CODEX)) assert(!p.includes(v));
  assert(
    codexExpiryProblem(parseCodexAuth(codexAuthText(now - 1)), 0, now) !==
      null,
  );
});

// H-02 minor owed at merge: an `expires` outside the Date range (|ms| > 8.64e15)
// is refused at parse, so the expiry refusal never throws a RangeError.
Deno.test("parseCodexAuth: expires outside the valid Date range is refused, the bounds load", () => {
  for (const x of [8.64e15 + 1, -8.64e15 - 1, Number.MAX_SAFE_INTEGER]) {
    assertThrows(
      () => parseCodexAuth(codexAuthText(x)),
      ConfigurationError,
      "Date range",
    );
  }
  for (const x of [8.64e15, -8.64e15]) {
    const a = parseCodexAuth(codexAuthText(x));
    assertEquals(a.expires, x);
    codexExpiryProblem(a, 30); // never throws
  }
});

Deno.test('releasedCodexAuth (H-02 review): the sandbox copy carries refresh ""; the rest unchanged', () => {
  const text = codexAuthText(1_900_000_000_000);
  const out = releasedCodexAuth(text);
  assert(!out.includes(FAKE_CODEX.refresh));
  assertEquals(
    JSON.parse(out),
    JSON.parse(codexAuthText(1_900_000_000_000, { refresh: "" })),
  );
  assertThrows(() => releasedCodexAuth("{}"), ConfigurationError);
});
