// SPIKE (throwaway): harness bench M0
// Usage: deno run --allow-all scripts/spikes/harness/redact-fixture.ts <in.jsonl> <out.jsonl> <secretsDir> [extraSecretFile...]
const [input, output, secretsDir, ...extra] = Deno.args;
if (!input || !output || !secretsDir) throw new Error("usage: see header");
let text = await Deno.readTextFile(input);
const files: string[] = [...extra];
for await (const e of Deno.readDir(secretsDir)) {
  if (e.isFile) files.push(`${secretsDir}\\${e.name}`);
}
const secrets: string[] = [];
for (const f of files) {
  const v = (await Deno.readTextFile(f)).trim();
  if (v.length >= 8) secrets.push(v);
}
for (const s of secrets) text = text.split(s).join("[REDACTED]");
text = text.replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED]").replace(
  /Bearer [A-Za-z0-9._-]{16,}/g,
  "Bearer [REDACTED]",
);
for (const s of secrets) {
  if (text.includes(s)) throw new Error("secret survived redaction");
}
await Deno.writeTextFile(output, text);
console.log(`[OK] redacted ${input} -> ${output}`);
