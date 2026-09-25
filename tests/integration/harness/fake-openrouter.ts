// A scripted OpenAI-compatible streaming endpoint on 127.0.0.1 standing in
// for OpenRouter (M3-02 runtime proof: no credential, no network). Each
// request consumes the next scripted turn; the last one repeats.

export type FakeTurn =
  | {
    kind: "text";
    text: string;
    usage: { prompt_tokens: number; completion_tokens: number };
  }
  | {
    kind: "tool";
    name: string;
    args: Record<string, unknown>;
    usage: { prompt_tokens: number; completion_tokens: number };
  }
  | { kind: "status"; status: number; body: string };

export function startFakeOpenRouter(script: FakeTurn[]) {
  const requests: {
    method: string;
    path: string;
    auth: string | null;
    body: unknown;
  }[] = [];
  const sse = (chunks: unknown[]) =>
    chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
    "data: [DONE]\n\n";
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen() {} },
    async (req) => {
      requests.push({
        method: req.method,
        path: new URL(req.url).pathname,
        auth: req.headers.get("authorization"),
        body: await req.json().catch(() => null),
      });
      const turn = script[Math.min(requests.length - 1, script.length - 1)]!;
      if (turn.kind === "status") {
        return new Response(turn.body, { status: turn.status });
      }
      const base = {
        id: `gen-${requests.length}`,
        object: "chat.completion.chunk",
        model: "google/gemini-3.8-flash",
      };
      const delta = turn.kind === "text"
        ? { role: "assistant", content: turn.text }
        : {
          role: "assistant",
          tool_calls: [{
            index: 0,
            id: `call_${requests.length}`,
            type: "function",
            function: { name: turn.name, arguments: JSON.stringify(turn.args) },
          }],
        };
      const usage = {
        ...turn.usage,
        total_tokens: turn.usage.prompt_tokens + turn.usage.completion_tokens,
      };
      return new Response(
        sse([
          { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
          {
            ...base,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: turn.kind === "text" ? "stop" : "tool_calls",
            }],
            usage,
          },
        ]),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  );
  return {
    baseUrl: `http://127.0.0.1:${server.addr.port}/v1`,
    requests,
    close: () => server.shutdown(),
  };
}
