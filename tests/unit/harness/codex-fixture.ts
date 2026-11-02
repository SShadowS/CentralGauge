/** Fake openai-codex credential values (H-02): never a real credential. */
export const FAKE_CODEX = {
  access: "eyJfake.access-token-0123456789abcdef.sig",
  refresh: "rt_fake-refresh-token-0123456789abcdef",
  accountId: "00000000-fake-4000-8000-account00001",
};

/** A pi auth.json holding the fake openai-codex entry. */
export const codexAuthText = (expires: number, over: object = {}) =>
  JSON.stringify(
    { "openai-codex": { type: "oauth", ...FAKE_CODEX, expires, ...over } },
    null,
    2,
  );
