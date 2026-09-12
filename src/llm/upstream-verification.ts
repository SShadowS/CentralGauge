// src/llm/upstream-verification.ts
//
// Per-attempt verification of the OpenRouter upstream (spec 2026-09-11
// upstream lock, D1 and D3). Pure: the caller supplies what was requested,
// what the resolved pin should echo, and what the response said.
import type { LLMResponse, UpstreamIdentitySource } from "./types.ts";

export type UpstreamVerification =
  | "not_applicable"
  | "unpinned"
  | "verified"
  | "mismatch"
  | "unverified"
  | "not_served";

export interface UpstreamFields {
  requestedUpstream: string | null;
  servedUpstream: string | null;
  servedUpstreamModel: string | null;
  upstreamIdentitySource: UpstreamIdentitySource | null;
  upstreamVerification: UpstreamVerification;
}

type ResponseIdentity = Pick<
  LLMResponse,
  | "servedUpstream"
  | "servedUpstreamModel"
  | "upstreamIdentitySource"
  | "upstreamIdentityConflict"
>;

export function classifyUpstream(input: {
  provider: string;
  requestedUpstream: string | null;
  expectedProviderName: string | null;
  response: ResponseIdentity | undefined;
}): UpstreamFields {
  if (input.provider !== "openrouter") {
    return {
      requestedUpstream: null,
      servedUpstream: null,
      servedUpstreamModel: null,
      upstreamIdentitySource: null,
      upstreamVerification: "not_applicable",
    };
  }
  const r = input.response;
  const served = r?.servedUpstream ?? null;
  const base = {
    requestedUpstream: input.requestedUpstream,
    servedUpstream: served,
    servedUpstreamModel: r?.servedUpstreamModel ?? null,
    upstreamIdentitySource: r?.upstreamIdentitySource ?? null,
  };
  if (input.requestedUpstream === null) {
    return { ...base, upstreamVerification: "unpinned" };
  }
  if (r === undefined) return { ...base, upstreamVerification: "not_served" };
  if (served === null) return { ...base, upstreamVerification: "unverified" };
  if (r.upstreamIdentityConflict === true) {
    return { ...base, upstreamVerification: "mismatch" };
  }
  return {
    ...base,
    upstreamVerification: served === input.expectedProviderName
      ? "verified"
      : "mismatch",
  };
}

/** A pinned run cannot be shown to have held its pin: excluded atomically at ingest (spec D3). */
export function isUpstreamCompromised(v: UpstreamVerification): boolean {
  return v === "mismatch" || v === "unverified";
}
