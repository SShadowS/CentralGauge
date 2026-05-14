# Vendored tree-sitter-al grammar

`tree-sitter-al.wasm` is the prebuilt WASM grammar for AL (Business Central
Application Language), used by `src/container/test-routing.ts` to detect
whether a test codeunit uses `TestPage` (which cannot run on the headless SOAP
test path).

- Source: [`@sshadows/tree-sitter-al`](https://github.com/SShadowS/tree-sitter-al)
- Version: 2.5.1 (git rev `8a2d841`)
- Runtime: loaded via `web-tree-sitter` (see `deno.json` imports)

## Updating

Copy a newer `tree-sitter-al.wasm` here and bump the version note above.

## `deno compile`

The bench runs via `deno run` (which reads this file at runtime — no action
needed). If you ship via `deno compile`, add
`--include vendor/tree-sitter-al/tree-sitter-al.wasm` so the grammar is bundled.
The `web-tree-sitter` runtime wasm under `deno compile` is untested.
