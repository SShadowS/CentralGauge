import type { RequestHandler } from "./$types";
import { readBodyWithCap } from "$lib/server/body-cap";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import {
  hashIp,
  hashToken,
  newEditToken,
  sealKey,
} from "$lib/server/submission-crypto";
import type { SealedKey } from "$lib/server/submission-crypto";
import {
  countRecentByIp,
  insertSubmission,
} from "$lib/server/setup-submissions";
import { verifyTurnstile } from "$lib/server/turnstile";
import {
  isZip,
  parseSubmissionFields,
  SUBMISSION_LIMITS as L,
} from "$lib/shared/setup-submission";

interface SubmissionEnv {
  TURNSTILE_SECRET_KEY?: string;
  SUBMISSION_KEY_SECRET?: string;
}

const BODY_CAP = L.zipBytes + L.instructionsBytes + 64 * 1024;
const DAY_MS = 86_400_000;
const hex = (b: Uint8Array) =>
  [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const env = platform.env as Cloudflare.Env & SubmissionEnv;
  let r2Key: string | null = null;
  try {
    const turnstileSecret = env.TURNSTILE_SECRET_KEY;
    const keySecret = env.SUBMISSION_KEY_SECRET;
    if (!turnstileSecret || !keySecret) {
      throw new ApiError(
        503,
        "submissions_unavailable",
        "submissions are not configured",
      );
    }

    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > BODY_CAP) {
      throw new ApiError(413, "payload_too_large", "submission is too large");
    }
    // The declared length can be absent or wrong, so always cap while reading.
    const bytes = await readBodyWithCap(request.body, BODY_CAP);
    let form: FormData;
    try {
      form = await new Response(bytes, {
        headers: { "content-type": request.headers.get("content-type") ?? "" },
      }).formData();
    } catch {
      throw new ApiError(400, "invalid_form", "expected multipart form data");
    }

    const ip = request.headers.get("cf-connecting-ip");
    const token = form.get("cf-turnstile-response");
    if (
      !(await verifyTurnstile(
        typeof token === "string" ? token : null,
        turnstileSecret,
        ip,
      ))
    ) {
      throw new ApiError(403, "captcha_failed", "captcha check failed");
    }

    const now = new Date();
    const createdAt = now.toISOString();
    const ipHash = await hashIp(ip ?? "unknown");
    // ponytail: check-then-insert race, so concurrent requests can exceed the cap slightly; bounded by the fresh Turnstile token each request needs.
    const recent = await countRecentByIp(
      env.DB,
      ipHash,
      new Date(now.getTime() - DAY_MS).toISOString(),
    );
    if (recent >= L.perIpPerDay) {
      throw new ApiError(429, "submission_limit", "too many submissions today");
    }

    const raw: Record<string, string> = {};
    for (const [k, v] of form.entries()) if (typeof v === "string") raw[k] = v;
    const parsed = parseSubmissionFields(raw, createdAt.slice(0, 10));
    if (!parsed.ok) {
      throw new ApiError(
        400,
        "invalid_submission",
        "some fields are invalid",
        parsed.errors,
      );
    }
    const f = parsed.value;

    const instr = form.get("instructions");
    if (!(instr instanceof File)) {
      throw new ApiError(400, "invalid_submission", "instructions required", {
        instructions: "Attach the instructions file.",
      });
    }
    let instructionsMd: string;
    try {
      if (instr.size > L.instructionsBytes) throw new Error("too big");
      instructionsMd = new TextDecoder("utf-8", { fatal: true }).decode(
        await instr.arrayBuffer(),
      );
    } catch {
      throw new ApiError(400, "invalid_submission", "bad instructions file", {
        instructions: `Instructions must be UTF-8 text up to ${
          L.instructionsBytes / 1024
        } KiB.`,
      });
    }

    const zip = form.get("zip");
    if (!(zip instanceof File)) {
      throw new ApiError(400, "invalid_submission", "zip required", {
        zip: "Attach the zip file.",
      });
    }
    if (zip.size > L.zipBytes) {
      throw new ApiError(413, "payload_too_large", "zip is too large");
    }
    const zipBytes = new Uint8Array(await zip.arrayBuffer());
    if (!isZip(zipBytes)) {
      throw new ApiError(400, "invalid_submission", "zip is not a zip file", {
        zip: "The attachment is not a zip file.",
      });
    }

    let sealed: SealedKey | null = null;
    if (f.key) sealed = await sealKey(f.key, keySecret);

    const id = hex(crypto.getRandomValues(new Uint8Array(16)));
    const editToken = newEditToken();
    const sha = hex(
      new Uint8Array(await crypto.subtle.digest("SHA-256", zipBytes)),
    );
    // Server-built from hex, so no traversal is possible (validateR2Key is
    // lifecycle/-prefixed and does not apply to this namespace).
    const key = `setup-submissions/${id}.zip`;
    await env.BLOBS.put(key, zipBytes, {
      httpMetadata: { contentType: "application/zip" },
    });
    r2Key = key;

    await insertSubmission(env.DB, {
      id,
      created_at: createdAt,
      ip_hash: ipHash,
      agent_tool: f.agent_tool,
      base_model: f.base_model,
      description: f.description,
      visibility: f.visibility,
      instructions_name: f.instructions_name,
      instructions_md: instructionsMd,
      roles_json: JSON.stringify(f.roles),
      flow: f.flow,
      zip_key: key,
      zip_bytes: zipBytes.byteLength,
      zip_sha256: sha,
      key_ciphertext: sealed?.ciphertext ?? null,
      key_iv: sealed?.iv ?? null,
      key_expires_on: f.key ? f.key_expires_on : null,
      edit_token_hash: await hashToken(editToken),
    });
    return jsonResponse(
      { id, edit_path: `/submit/edit/${id}#${editToken}` },
      201,
    );
  } catch (err) {
    if (r2Key) await env.BLOBS.delete(r2Key).catch(() => {});
    // Never echo D1/R2/crypto internals to the public.
    return errorResponse(
      err instanceof ApiError
        ? err
        : new ApiError(500, "internal_error", "Submission failed."),
    );
  }
};
