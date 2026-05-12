/**
 * Return last `maxBytes` characters of `text`. (We count chars, not bytes -
 * AL/PowerShell output is ASCII-dominant; close enough for tail trimming.)
 */
export function captureRawTail(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text;
  return text.slice(text.length - maxBytes);
}

/**
 * Write `content` to a file in `dir` with a basename derived from `key`.
 * Returns absolute path. Sanitizes `key` to remove path-unsafe characters.
 */
export async function writeArtifact(
  dir: string,
  key: string,
  content: string,
): Promise<string> {
  await Deno.mkdir(dir, { recursive: true });
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${dir}/${safe}.log`;
  await Deno.writeTextFile(path, content);
  return path;
}
