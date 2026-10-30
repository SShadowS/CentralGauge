import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { seedSetups } from "../utils/seed-setups";

const page = (ids: string) => SELF.fetch(`https://x/setups/compare?ids=${ids}`);
const SSR_TIMEOUT_MS = 30_000;

describe("GET /setups/compare", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });
  beforeEach(async () => {
    await resetDb();
    await seedSetups(env.DB);
  });

  it("renders both setups", async () => {
    const res = await page("cc-plain,pi-default");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("cc-plain description");
    expect(html).toContain("pi-default description");
  }, SSR_TIMEOUT_MS);

  it("one id gives the empty state", async () => {
    const res = await page("cc-plain");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Pick two setups on the ranking page");
  }, SSR_TIMEOUT_MS);

  it("duplicate ids give the empty state", async () => {
    const res = await page("cc-plain,cc-plain");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Pick two setups on the ranking page");
  }, SSR_TIMEOUT_MS);

  it("three ids give 400", async () => {
    expect((await page("cc-plain,pi-default,codex-old")).status).toBe(400);
  }, SSR_TIMEOUT_MS);

  it("unknown id gives 404", async () => {
    expect((await page("cc-plain,nope")).status).toBe(404);
  }, SSR_TIMEOUT_MS);

  it("never leaks private contents", async () => {
    const res = await page("cc-plain,cc-secret");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("SECRET-BODY");
    expect(html).not.toContain("SECRET-FLOW");
  }, SSR_TIMEOUT_MS);

  it("different sets show the notice instead of the grid", async () => {
    const res = await page("cc-plain,codex-old");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("These setups have no results on the same task set.");
  }, SSR_TIMEOUT_MS);

  it("same set shows the grid", async () => {
    const html = await (await page("cc-plain,pi-default")).text();
    expect(html).not.toContain("These setups have no results on the same task set.");
    expect(html).toContain("HX-001");
  }, SSR_TIMEOUT_MS);
});
