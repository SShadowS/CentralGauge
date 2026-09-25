import { parse } from "@std/yaml";
import { basename } from "@std/path";
import type { z } from "zod";
import { ValidationError } from "../errors.ts";

/**
 * Read a YAML file and validate it with a Zod schema. Every failure (missing
 * file, YAML syntax, duplicate key, schema issue) throws a ValidationError
 * that names the file, so a bad file can never load silently.
 */
export async function readYaml<T extends z.ZodType>(
  path: string,
  schema: T,
): Promise<z.output<T>> {
  let raw: unknown;
  try {
    raw = parse(await Deno.readTextFile(path));
  } catch (err) {
    const msg = err instanceof Error
      ? err.message.split("\n")[0]!
      : String(err);
    throw new ValidationError(`${path}: ${msg}`, [msg]);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues.map((i) =>
      `${i.path.join(".") || "(root)"}: ${i.message}`
    );
    throw new ValidationError(
      `Invalid ${basename(path)} at ${path}:\n  ${errors.join("\n  ")}`,
      errors,
    );
  }
  return result.data;
}
