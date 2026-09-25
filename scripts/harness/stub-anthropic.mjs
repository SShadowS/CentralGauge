// Scripted Anthropic Messages API, run inside the sandbox on 127.0.0.1 (M2-04).
// For fixture recording (M2-11) and arm qualification (M2-13) without a
// credential. node: built-ins only (runs under Node in the image, Deno in tests).
import { appendFileSync, readFileSync } from "node:fs";
import http from "node:http";
import process from "node:process";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const count = (
  v,
  d,
) => (v === undefined ? d : Number.isSafeInteger(v) && v >= 0 ? v : NaN);

export function checkScenario(s) {
  const fail = (p, why) => {
    throw new Error(`scenario ${p}: ${why}`);
  };
  if (!isObj(s) || !Array.isArray(s.steps)) fail("steps", "must be an array");
  if (
    s.after !== undefined && s.after !== "end_turn" && s.after !== "repeat_last"
  ) fail("after", "end_turn or repeat_last");
  const steps = s.steps.map((st, i) => {
    const p = `steps[${i}]`;
    if (!isObj(st)) fail(p, "must be an object");
    if (st.status !== undefined) {
      if (
        !Number.isInteger(st.status) || st.status < 400 ||
        typeof st.error_type !== "string"
      ) fail(p, "status >= 400 and error_type");
      return { status: st.status, error_type: st.error_type };
    }
    if (
      !Array.isArray(st.content) ||
      !["end_turn", "tool_use"].includes(st.stop_reason)
    ) fail(p, "content array and stop_reason");
    for (const [k, b] of st.content.entries()) {
      const ok = isObj(b) &&
        ((b.type === "text" && typeof b.text === "string") ||
          (b.type === "tool_use" && typeof b.id === "string" &&
            typeof b.name === "string" && isObj(b.input)));
      if (!ok) fail(`${p}.content[${k}]`, "text or tool_use block");
    }
    const u = isObj(st.usage) ? st.usage : {};
    const usage = {
      input_tokens: count(u.input_tokens, 10),
      output_tokens: count(u.output_tokens, 5),
      cache_read_input_tokens: count(u.cache_read_input_tokens, 0),
      cache_creation_input_tokens: count(u.cache_creation_input_tokens, 0),
    };
    if (Object.values(usage).some(Number.isNaN)) {
      fail(`${p}.usage`, "non-negative integers");
    }
    return { content: st.content, stop_reason: st.stop_reason, usage };
  });
  return { steps, after: s.after ?? "end_turn" };
}

const DONE = {
  content: [{ type: "text", text: "done" }],
  stop_reason: "end_turn",
  usage: {
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
};
const usageOf = (m) => ({
  ...m.usage,
  cache_creation: {
    ephemeral_5m_input_tokens: m.usage.cache_creation_input_tokens,
    ephemeral_1h_input_tokens: 0,
  },
});
const JSON_H = { "content-type": "application/json" };

function sse(model, id, m) {
  const ev = (type, data) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev("message_start", {
    message: {
      id,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { ...usageOf(m), output_tokens: 1 },
    },
  });
  m.content.forEach((b, index) => {
    out += b.type === "text"
      ? ev("content_block_start", {
        index,
        content_block: { type: "text", text: "" },
      }) +
        ev("content_block_delta", {
          index,
          delta: { type: "text_delta", text: b.text },
        })
      : ev("content_block_start", {
        index,
        content_block: { type: "tool_use", id: b.id, name: b.name, input: {} },
      }) +
        ev("content_block_delta", {
          index,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify(b.input),
          },
        });
    out += ev("content_block_stop", { index });
  });
  return out +
    ev("message_delta", {
      delta: { stop_reason: m.stop_reason, stop_sequence: null },
      usage: { output_tokens: m.usage.output_tokens },
    }) + ev("message_stop", {});
}

export function createStub(s) {
  let next = 0;
  let n = 0;
  return (method, path, body) => {
    /** @type {{ i: number; path: string; model: string | null; stream: boolean | null; step: number | null; status: number }} */
    const log = {
      i: ++n,
      path,
      model: null,
      stream: null,
      step: null,
      status: 404,
    };
    const done = (status, headers, text) => ({
      status,
      headers,
      body: text,
      log: { ...log, status },
    });
    if (method === "POST" && path === "/v1/messages/count_tokens") {
      return done(200, JSON_H, JSON.stringify({ input_tokens: 1 }));
    }
    if (method !== "POST" || path !== "/v1/messages") {
      return done(
        404,
        JSON_H,
        JSON.stringify({
          type: "error",
          error: { type: "not_found_error", message: path },
        }),
      );
    }
    let req = {};
    try {
      req = JSON.parse(body || "{}");
    } catch { /* treat as empty */ }
    const model = typeof req.model === "string" ? req.model : "stub";
    log.model = model;
    log.stream = req.stream === true;
    const idx = next < s.steps.length
      ? next++
      : s.after === "repeat_last" && s.steps.length > 0
      ? s.steps.length - 1
      : null;
    log.step = idx;
    const step = idx === null ? DONE : s.steps[idx];
    if (step.status !== undefined) {
      return done(
        step.status,
        JSON_H,
        JSON.stringify({
          type: "error",
          error: { type: step.error_type, message: "stub" },
        }),
      );
    }
    const id = `msg_stub_${n}`;
    if (!log.stream) {
      return done(
        200,
        JSON_H,
        JSON.stringify({
          id,
          type: "message",
          role: "assistant",
          model,
          content: step.content,
          stop_reason: step.stop_reason,
          stop_sequence: null,
          usage: usageOf(step),
        }),
      );
    }
    return done(
      200,
      { "content-type": "text/event-stream" },
      sse(model, id, step),
    );
  };
}

if (/stub-anthropic\.mjs$/.test(process.argv[1] ?? "")) {
  const [scenarioPath, logPath, port] = process.argv.slice(2);
  const stub = createStub(
    checkScenario(JSON.parse(readFileSync(scenarioPath, "utf8"))),
  );
  http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      if (body.length < 1_000_000) body += c;
    });
    req.on("end", () => {
      const r = stub(
        req.method ?? "GET",
        new URL(req.url ?? "/", "http://stub").pathname,
        body,
      );
      appendFileSync(logPath, JSON.stringify(r.log) + "\n");
      res.writeHead(r.status, r.headers).end(r.body);
    });
  }).listen(Number(port), "127.0.0.1");
}
