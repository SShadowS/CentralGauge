#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net
/**
 * smoke-ingest.ts
 *
 * End-to-end smoke test for the signed ingest endpoint.
 *
 * Loads a local Ed25519 private key (32 raw bytes), constructs a minimal
 * SignedRunPayload (version 1) with a synthetic run_id / task_set_hash /
 * model, canonical-JSON-signs the payload, and POSTs it to the target
 * /api/v1/runs endpoint.
 *
 * Success for this test = the server's crypto + transport path works.
 *
 * Because no reference rows (task_set, model, cost_snapshot) exist for the
 * synthetic values, the server will return a structured 400 with one of:
 *   unknown_task_set | unknown_model | unknown_pricing
 * That is a PASS — it proves verifySignedRequest accepted the signature and
 * the request reached the business-logic layer.
 *
 * Failure modes:
 *   - 401 unknown_key / bad_signature / revoked_key  → signature path broken
 *   - 403 insufficient_scope                         → key scope wrong
 *   - 400 bad_version / missing_run_id / clock_skew  → envelope broken
 *   - 5xx / network error                            → deployment broken
 *
 * Usage:
 *   deno run -A scripts/smoke-ingest.ts \
 *     --url https://centralgauge-preview.sshadows.workers.dev \
 *     --key ~/.centralgauge/keys/preview-ingest.ed25519 \
 *     --key-id 1 \
 *     --machine-id preview-ingest
 */

import * as ed from "npm:@noble/ed25519@3.1.0";
import { encodeBase64 } from "jsr:@std/encoding@^1.0.5/base64";

interface CliArgs {
  url: string;
  keyPath: string;
  keyId: number;
  machineId: string;
}

function usage(): never {
  console.error(
    "usage: smoke-ingest.ts --url <base> --key <path> --key-id <n> --machine-id <id>",
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
  if (!home) throw new Error("cannot expand ~: neither HOME nor USERPROFILE set");
  return home + path.slice(1);
}

async function main(): Promise<number> {
  const args = parseArgs(Deno.args);

  const privateKey = await Deno.readFile(expandHome(args.keyPath));
  if (privateKey.length !== 32) {
    console.error(
      `[FAIL] private key must be 32 raw bytes (got ${privateKey.length})`,
    );
    return 2;
  }

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

  const canonical = canonicalJSON(payload);
  const messageBytes = new TextEncoder().encode(canonical);
  const signature = await ed.signAsync(messageBytes, privateKey);

  const body = {
    version: 1,
    run_id: runId,
    signature: {
      alg: "Ed25519",
      key_id: args.keyId,
      signed_at: now,
      value: encodeBase64(signature),
    },
    payload,
  };

  const target = `${args.url}/api/v1/runs`;
  console.error(`[INFO] POST ${target}`);
  console.error(`[INFO] run_id    = ${runId}`);
  console.error(`[INFO] key_id    = ${args.keyId}`);
  console.error(`[INFO] canonical = ${canonical.slice(0, 120)}${canonical.length > 120 ? "…" : ""}`);

  const resp = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  const pretty = typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);

  console.error(`[INFO] status    = ${resp.status}`);
  console.error(`[INFO] response  =\n${pretty}`);

  const errCode =
    typeof parsed === "object" && parsed !== null && "code" in parsed
      ? String((parsed as { code: unknown }).code)
      : null;

  if (resp.status === 202 || resp.status === 200) {
    console.error(`[OK] ingest accepted (status ${resp.status})`);
    return 0;
  }
  if (
    resp.status === 400 &&
    (errCode === "unknown_task_set" ||
      errCode === "unknown_model" ||
      errCode === "unknown_pricing")
  ) {
    console.error(
      `[OK] signature verified; business validation correctly rejected synthetic data (${errCode})`,
    );
    return 0;
  }
  console.error(`[FAIL] unexpected response (code=${errCode ?? "n/a"})`);
  return 1;
}

if (import.meta.main) {
  Deno.exit(await main());
}
