/**
 * H-35: read a compiled AL package's manifest (NavxManifest.xml) on the host.
 * A .app is a NAVX header (magic "NAVX", uint32 header length) followed by a
 * zip archive. Only what a target check needs: the `Target` attribute of the
 * manifest's <App> element. Anything malformed is null (callers fail closed).
 */

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The manifest entry's bytes, or null. */
async function manifestBytes(file: Uint8Array): Promise<Uint8Array | null> {
  if (
    file.length < 8 || new TextDecoder().decode(file.subarray(0, 4)) !== "NAVX"
  ) {
    return null;
  }
  const zip = file.subarray(u32(file, 4));
  // End of central directory: the last signature 0x06054b50.
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0 && i >= zip.length - 22 - 65535; i--) {
    if (u32(zip, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = u16(zip, eocd + 10);
  let p = u32(zip, eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (p + 46 > zip.length || u32(zip, p) !== 0x02014b50) return null;
    const method = u16(zip, p + 10);
    const size = u32(zip, p + 20);
    const nameLen = u16(zip, p + 28);
    const extraLen = u16(zip, p + 30);
    const commentLen = u16(zip, p + 32);
    const local = u32(zip, p + 42);
    const name = new TextDecoder().decode(
      zip.subarray(p + 46, p + 46 + nameLen),
    );
    if (name === "NavxManifest.xml") {
      if (local + 30 > zip.length || u32(zip, local) !== 0x04034b50) {
        return null;
      }
      const start = local + 30 + u16(zip, local + 26) + u16(zip, local + 28);
      if (start + size > zip.length) return null;
      const data = zip.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return await inflateRaw(data);
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** The `Target` the package's manifest records ("Cloud", "OnPrem", ...), or null. */
export async function packageManifestTarget(
  path: string,
): Promise<string | null> {
  try {
    const bytes = await manifestBytes(await Deno.readFile(path));
    if (!bytes) return null;
    const xml = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
    const app = /<App\b[^>]*>/.exec(xml)?.[0];
    return app ? /\bTarget="([^"]*)"/.exec(app)?.[1] ?? null : null;
  } catch {
    return null;
  }
}
