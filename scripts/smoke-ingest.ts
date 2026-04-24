#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net
/**
 * smoke-ingest.ts
 *
 * End-to-end smoke test(s) for the signed ingest endpoints.
 *
 * Subcommands:
 *
 *   simple
 *     Posts a minimal SignedRunPayload with synthetic references. The server
 *     will reject with 400 unknown_task_set / unknown_model / unknown_pricing
 *     — that is a PASS (it proves signature verification and transport work).
 *
 *   full
 *     1. Uploads two random-body blobs via PUT /api/v1/blobs/:sha256 using
 *        header-signed auth (X-CG-Signature / X-CG-Key-Id / X-CG-Signed-At).
 *     2. Calls POST /api/v1/runs/precheck with a payload referencing those
 *        two blobs and expects `missing_blobs: []`.
 *     3. Calls POST /api/v1/runs with the same payload and expects either
 *        202 (accepted) or 400 with code unknown_task_set / unknown_model /
 *        unknown_pricing (signature ok, business validation rejected).
 *
 * Usage:
 *   deno run -A scripts/smoke-ingest.ts simple \
 *     --url https://centralgauge-preview.sshadows.workers.dev \
 *     --key ~/.centralgauge/keys/preview-ingest.ed25519 \
 *     --key-id 1 --machine-id preview-ingest
 *
 *   deno run -A scripts/smoke-ingest.ts full \
 *     --url https://centralgauge-preview.sshadows.workers.dev \
 *     --key ~/.centralgauge/keys/preview-ingest.ed25519 \
 *     --key-id 1 --machine-id preview-ingest
 */

import * as ed from "npm:@noble/ed25519@3.1.0";
import { encodeBase64 } from "jsr:@std/encoding@^1.0.5/base64";
import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { signBlobUpload } from "../src/ingest/sign.ts";

interface CliArgs {
  url: string;
  keyPath: string;
  keyId: number;
  machineId: string;
}

function usage(): never {
  console.error(
    "usage: smoke-ingest.ts <simple|full> --url <base> --key <path> --key-id <n> --machine-id <id>",
  );
  Deno.exit(2);
}

function parseArgs(argv: string[]): CliArgs {
  let url: string | null = null;
  let keyPath: string | null = null;
  let keyId: number | null = null;
  let machineId: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? usage();
    if (arg === "--url") url = next();
    else if (arg === "--key") keyPath = next();
    else if (arg === "--key-id") keyId = parseInt(next(), 10);
    else if (arg === "--machine-id") machineId = next();
    else {
      console.error(`[FAIL] unknown flag '${arg}'`);
      usage();
    }
  }
  if (!url || !keyPath || keyId === null || !machineId) usage();
  if (!Number.isFinite(keyId) || keyId < 1) {
    console.error(`[FAIL] --key-id must be a positive integer`);
    Deno.exit(2);
  }
  return { url: url.replace(/\/+$/, ""), keyPath, keyId, machineId };
}

function canonicalJSON(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonicalJSON: non-finite number");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("canonicalJSON: cycle detected");
    seen.add(value);
    return "[" + value.map((x) => canonicalJSON(x, seen)).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) throw new Error("canonicalJSON: cycle detected");
    seen.add(obj);
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) {
        throw new Error(`canonicalJSON: undefined value at key "${k}"`);
      }
      parts.push(JSON.stringify(k) + ":" + canonicalJSON(v, seen));
    }
    return "{" + parts.join(",") + "}";
  }
  throw new Error(`canonicalJSON: unsupported type ${typeof value}`);
}

function expandHome(path: string): string {
  if (!path.startsWith("~")) return path;
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (!home) {
    throw new Error("cannot expand ~: neither HOME nor USERPROFILE set");
  }
  return home + path.slice(1);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return encodeHex(new Uint8Array(digest));
}

async function loadPrivateKey(path: string): Promise<Uint8Array> {
  const key = await Deno.readFile(expandHome(path));
  if (key.length !== 32) {
    throw new Error(`private key must be 32 raw bytes (got ${key.length})`);
  }
  return key;
}

interface SignedEnvelope {
  version: 1;
  run_id: string;
  signature: {
    alg: "Ed25519";
    key_id: number;
    signed_at: string;
    value: string;
  };
  payload: Record<string, unknown>;
}

async function signEnvelope(
  runId: string,
  payload: Record<string, unknown>,
  privateKey: Uint8Array,
  keyId: number,
  now: Date = new Date(),
): Promise<SignedEnvelope> {
  const canonical = canonicalJSON(payload);
  const messageBytes = new TextEncoder().encode(canonical);
  const signature = await ed.signAsync(messageBytes, privateKey);
  return {
    version: 1,
    run_id: runId,
    signature: {
      alg: "Ed25519",
      key_id: keyId,
      signed_at: now.toISOString(),
      value: encodeBase64(signature),
    },
    payload,
  };
}

function randomBody(label: string): Uint8Array {
  const nonce = crypto.randomUUID();
  const stamp = new Date().toISOString();
  const text = `=== ${label} ===\nnonce=${nonce}\nstamp=${stamp}\n`;
  return new TextEncoder().encode(text);
}

async function putBlob(
  baseUrl: string,
  sha256: string,
  body: Uint8Array,
  privateKey: Uint8Array,
  keyId: number,
): Promise<"created" | "exists"> {
  const path = `/api/v1/blobs/${sha256}`;
  const { signature, signed_at } = await signBlobUpload(
    path,
    sha256,
    privateKey,
    keyId,
  );
  const resp = await fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers: {
      "content-type": "application/octet-stream",
      "x-cg-signature": signature,
      "x-cg-key-id": String(keyId),
      "x-cg-signed-at": signed_at,
    },
    body: body as BodyInit,
  });
  const text = await resp.text();
  if (resp.status === 201) {
    console.error(`[INFO]  PUT ${path} -> 201 created`);
    return "created";
  }
  if (resp.status === 200) {
    console.error(`[INFO]  PUT ${path} -> 200 exists`);
    return "exists";
  }
  throw new Error(`blob upload failed: ${resp.status} ${text}`);
}

function summarizeRunResponse(status: number, parsed: unknown): boolean {
  const errCode = typeof parsed === "object" && parsed !== null &&
      "code" in parsed
    ? String((parsed as { code: unknown }).code)
    : null;
  if (status === 202 || status === 200) {
    console.error(`[OK] ingest accepted (status ${status})`);
    return true;
  }
  if (
    status === 400 &&
    (errCode === "unknown_task_set" ||
      errCode === "unknown_model" ||
      errCode === "unknown_pricing")
  ) {
    console.error(
      `[OK] signature verified; business validation correctly rejected synthetic data (${errCode})`,
    );
    return true;
  }
  console.error(`[FAIL] unexpected response (code=${errCode ?? "n/a"})`);
  return false;
}

async function cmdSimple(args: CliArgs): Promise<number> {
  const privateKey = await loadPrivateKey(args.keyPath);
  const runId = `smoke-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const payload = {
    task_set_hash: "smoke-test-nonexistent-hash",
    model: {
      slug: "smoke-test-model",
      api_model_id: "smoke/test-model",
      family_slug: "smoke",
    },
    settings: {
      temperature: 0.2,
      max_attempts: 2,
    },
    machine_id: args.machineId,
    started_at: now,
    completed_at: now,
    pricing_version: "smoke-test-pricing-v0",
    results: [] as unknown[],
  };

  const envelope = await signEnvelope(runId, payload, privateKey, args.keyId);
  const target = `${args.url}/api/v1/runs`;
  console.error(`[INFO] POST ${target}`);
  console.error(`[INFO] run_id    = ${runId}`);
  console.error(`[INFO] key_id    = ${args.keyId}`);

  const resp = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope),
  });
  const text = await resp.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  const pretty = typeof parsed === "string"
    ? parsed
    : JSON.stringify(parsed, null, 2);
  console.error(`[INFO] status    = ${resp.status}`);
  console.error(`[INFO] response  =\n${pretty}`);

  return summarizeRunResponse(resp.status, parsed) ? 0 : 1;
}

async function cmdFull(args: CliArgs): Promise<number> {
  const privateKey = await loadPrivateKey(args.keyPath);

  // 1. Generate random transcript + code bodies and compute their hashes.
  const transcript = randomBody("TRANSCRIPT");
  const code = randomBody("CODE");
  const transcriptHash = await sha256Hex(transcript);
  const codeHash = await sha256Hex(code);
  console.error(`[INFO] transcript sha256 = ${transcriptHash}`);
  console.error(`[INFO] code       sha256 = ${codeHash}`);

  // 2. PUT both blobs with header-signed auth.
  await putBlob(args.url, transcriptHash, transcript, privateKey, args.keyId);
  await putBlob(args.url, codeHash, code, privateKey, args.keyId);

  // Build a minimal run payload that references those two blobs.
  const runId = `smoke-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const payload = {
    task_set_hash: "smoke-test-nonexistent-hash",
    model: {
      slug: "smoke-test-model",
      api_model_id: "smoke/test-model",
      family_slug: "smoke",
    },
    settings: { temperature: 0.2, max_attempts: 2 },
    machine_id: args.machineId,
    started_at: now,
    completed_at: now,
    pricing_version: "smoke-test-pricing-v0",
    results: [
      {
        task_id: "smoke-task-1",
        attempt: 1,
        passed: false,
        score: 0,
        compile_success: false,
        tests_total: 0,
        tests_passed: 0,
        tokens_in: 0,
        tokens_out: 0,
        transcript_sha256: transcriptHash,
        code_sha256: codeHash,
      },
    ],
  };

  // 3. POST /api/v1/runs/precheck, expect missing_blobs: [].
  const preEnvelope = await signEnvelope(
    runId,
    payload,
    privateKey,
    args.keyId,
  );
  const precheckUrl = `${args.url}/api/v1/runs/precheck`;
  console.error(`[INFO] POST ${precheckUrl}`);
  const preResp = await fetch(precheckUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(preEnvelope),
  });
  const preText = await preResp.text();
  let preParsed: unknown;
  try {
    preParsed = JSON.parse(preText);
  } catch {
    preParsed = preText;
  }
  console.error(`[INFO] precheck status = ${preResp.status}`);
  console.error(
    `[INFO] precheck body   = ${
      typeof preParsed === "string" ? preParsed : JSON.stringify(preParsed)
    }`,
  );
  if (preResp.status !== 200) {
    console.error(`[FAIL] precheck returned ${preResp.status}`);
    return 1;
  }
  const missing = typeof preParsed === "object" && preParsed !== null &&
      "missing_blobs" in preParsed &&
      Array.isArray((preParsed as { missing_blobs: unknown }).missing_blobs)
    ? (preParsed as { missing_blobs: string[] }).missing_blobs
    : null;
  if (missing === null) {
    console.error(`[FAIL] precheck response missing 'missing_blobs' array`);
    return 1;
  }
  if (missing.length !== 0) {
    console.error(
      `[FAIL] precheck reports ${missing.length} missing blob(s) after upload: ${
        missing.join(", ")
      }`,
    );
    return 1;
  }
  console.error(`[OK] precheck returned empty missing_blobs after uploads`);

  // 4. POST /api/v1/runs, expect 202 or 400 unknown_task_set|model|pricing.
  const runEnvelope = await signEnvelope(
    runId,
    payload,
    privateKey,
    args.keyId,
  );
  const runsUrl = `${args.url}/api/v1/runs`;
  console.error(`[INFO] POST ${runsUrl}`);
  const runResp = await fetch(runsUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(runEnvelope),
  });
  const runText = await runResp.text();
  let runParsed: unknown;
  try {
    runParsed = JSON.parse(runText);
  } catch {
    runParsed = runText;
  }
  console.error(`[INFO] runs status = ${runResp.status}`);
  console.error(
    `[INFO] runs body   = ${
      typeof runParsed === "string"
        ? runParsed
        : JSON.stringify(runParsed, null, 2)
    }`,
  );
  return summarizeRunResponse(runResp.status, runParsed) ? 0 : 1;
}

async function main(): Promise<number> {
  const [sub, ...rest] = Deno.args;
  if (!sub || sub === "-h" || sub === "--help") usage();
  switch (sub) {
    case "simple":
      return await cmdSimple(parseArgs(rest));
    case "full":
      return await cmdFull(parseArgs(rest));
    default:
      console.error(`[FAIL] unknown subcommand '${sub}'`);
      usage();
  }
}

if (import.meta.main) {
  Deno.exit(await main());
}
