import { parse } from "jsr:@std/yaml@^1.1.0";
import type { Check, DoctorContext } from "../../types.ts";

const FILES = ["models.yml", "model-families.yml", "pricing.yml"] as const;

export const checkCatalogLocal: Check = {
  id: "catalog.local",
  level: "A",
  async run(ctx: DoctorContext) {
    const dir = `${ctx.cwd}/site/catalog`;
    try {
      await Deno.stat(dir);
    } catch {
      return {
        id: "catalog.local",
        level: "A" as const,
        status: "failed" as const,
        message: `site/catalog directory missing at ${dir}`,
        durationMs: 0,
      };
    }

    const errors: Array<{ file: string; error: string }> = [];
    for (const f of FILES) {
      try {
        const text = await Deno.readTextFile(`${dir}/${f}`);
        parse(text);
      } catch (e) {
        errors.push({
          file: f,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (errors.length > 0) {
      return {
        id: "catalog.local",
        level: "A" as const,
        status: "failed" as const,
        message: `parse error in: ${errors.map((e) => e.file).join(", ")}`,
        remediation: {
          summary: "Fix YAML syntax in site/catalog/*.yml",
          autoRepairable: false,
        },
        details: { errors },
        durationMs: 0,
      };
    }

    return {
      id: "catalog.local",
      level: "A" as const,
      status: "passed" as const,
      message: `${FILES.join(" + ")} ok`,
      durationMs: 0,
    };
  },
};
