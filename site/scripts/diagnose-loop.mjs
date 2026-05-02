// One-shot Playwright diagnostic: load production homepage, capture network
// requests + console errors, watch for repeated requests indicating a loop.
import { chromium } from "@playwright/test";

const URL = process.argv[2] || "https://centralgauge.sshadows.workers.dev/";
const DURATION_MS = 8000;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const requests = [];
const consoleMsgs = [];
const errors = [];

page.on("request", (r) => {
  requests.push({
    ts: Date.now(),
    method: r.method(),
    url: r.url(),
    type: r.resourceType(),
  });
});
page.on("console", (m) => {
  consoleMsgs.push({ type: m.type(), text: m.text().slice(0, 500) });
});
page.on("pageerror", (e) => {
  errors.push(String(e).slice(0, 800));
});

console.log(`[diagnose] navigating ${URL}`);
const t0 = Date.now();
try {
  await page.goto(URL, { waitUntil: "networkidle", timeout: 15000 });
  console.log(`[diagnose] networkidle reached in ${Date.now() - t0}ms`);
} catch (e) {
  console.log(
    `[diagnose] navigation didn't reach networkidle in 15s — likely a loop`,
  );
}

console.log(`[diagnose] dwelling ${DURATION_MS}ms to observe ongoing activity`);
await page.waitForTimeout(DURATION_MS);

// Aggregate
const byUrl = new Map();
for (const r of requests) {
  byUrl.set(r.url, (byUrl.get(r.url) || 0) + 1);
}
const repeats = [...byUrl.entries()].filter(([_, c]) => c > 3).sort((a, b) =>
  b[1] - a[1]
);

console.log(`\n=== TOTALS ===`);
console.log(`Total requests: ${requests.length}`);
console.log(`Distinct URLs: ${byUrl.size}`);
console.log(`Console messages: ${consoleMsgs.length}`);
console.log(`Page errors: ${errors.length}`);

if (repeats.length > 0) {
  console.log(`\n=== REPEATED REQUESTS (>3x — likely loop) ===`);
  for (const [url, count] of repeats.slice(0, 20)) {
    console.log(`  ${count}× ${url}`);
  }
}

if (errors.length > 0) {
  console.log(`\n=== PAGE ERRORS ===`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
}

const errs = consoleMsgs.filter((m) =>
  m.type === "error" || m.type === "warning"
);
if (errs.length > 0) {
  console.log(`\n=== CONSOLE ERRORS/WARNINGS ===`);
  for (const m of errs.slice(0, 20)) console.log(`  [${m.type}] ${m.text}`);
}

await browser.close();
