/**
 * Encoder for the HNS VolatileStore network value (the format decodeHnsBlob
 * reads), and one real value captured read-only on the M1-34 host
 * (cg-harness-sandbox, 2026-09-26) as the format's regression fixture.
 */

type Enc = { t: number; b: Uint8Array };

const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const u16 = (n: number) => new Uint8Array(new Uint16Array([n]).buffer);
const u32b = (n: number) => new Uint8Array(new Uint32Array([n]).buffer);
const utf16 = (s: string) => {
  const b = new Uint8Array((s.length + 1) * 2);
  for (let i = 0; i < s.length; i++) {
    b[i * 2] = s.charCodeAt(i) & 0xff;
    b[i * 2 + 1] = s.charCodeAt(i) >> 8;
  }
  return cat(u32b(s.length + 1), b);
};

export const hns = {
  str: (s: string): Enc => ({ t: 5, b: utf16(s) }),
  u32: (n: number): Enc => ({ t: 2, b: u32b(n) }),
  bool: (x: boolean): Enc => ({ t: 1, b: u32b(x ? 1 : 0) }),
  u64: (n: number): Enc => ({ t: 3, b: cat(u32b(n), u32b(0)) }),
  guid: (g: string): Enc => {
    const h = g.replaceAll("-", "");
    const bytes = (s: string) =>
      Uint8Array.from(s.match(/../g)!.map((x) => parseInt(x, 16)));
    return {
      t: 4,
      b: cat(
        bytes(h.slice(0, 8)).reverse(),
        bytes(h.slice(8, 12)).reverse(),
        bytes(h.slice(12, 16)).reverse(),
        bytes(h.slice(16)),
      ),
    };
  },
  obj: (entries: [string, Enc][], flags = 0x12): Enc => ({
    t: 7,
    b: cat(
      u16(0xfffe),
      ...entries.map(([k, v]) => cat(u16(v.t), u32b(flags), utf16(k), v.b)),
      u16(0xfffd),
    ),
  }),
  arr: (items: Enc[]): Enc => ({
    t: 8,
    b: cat(u32b(items.length), ...items.map((i) => i.b)),
  }),
  raw: (t: number, b: Uint8Array): Enc => ({ t, b }),
};

/** A network value shaped like the real one; entries can be replaced or added. */
export function networkBlob(o: {
  id: string;
  name: string;
  type?: string;
  subnets?: string[];
  extra?: [string, Enc][];
  drop?: string[];
}): Uint8Array {
  const entries: [string, Enc][] = [
    ["ActivityId", hns.guid("C9112050-1C16-4363-801E-14082CA72E78")],
    ["AdditionalParams", hns.obj([])],
    ["CurrentEndpointCount", hns.u32(0)],
    [
      "Extensions",
      hns.arr([
        hns.obj([["Id", hns.guid("E7C3B2F0-F3C5-48DF-AF2B-10FED6D72E7A")], [
          "IsEnabled",
          hns.bool(false),
        ], ["Name", hns.str("Microsoft Windows Filtering Platform")]]),
      ]),
    ],
    ["Flags", hns.u32(8)],
    ["ID", hns.guid(o.id)],
    ["IPv6", hns.bool(false)],
    ["Name", hns.str(o.name)],
    ["ObjectType", hns.u32(1)],
    ["Policies", hns.arr([])],
    ["State", hns.u32(1)],
    [
      "Subnets",
      hns.arr(
        (o.subnets ?? ["172.30.60.0/24"]).map((p) =>
          hns.obj([["AddressPrefix", hns.str(p)], [
            "GatewayAddress",
            hns.str("172.30.60.1"),
          ], ["Policies", hns.arr([])]])
        ),
      ),
    ],
    ["Type", hns.str(o.type ?? "internal")],
    ["Version", hns.u64(16)],
  ];
  const kept = entries.filter(([k]) => !(o.drop ?? []).includes(k));
  return hns.obj([...kept, ...(o.extra ?? [])]).b;
}

export const blobB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

/** The real value of HNS network D9198B5B-... (Name = the docker network id, internal, 172.30.60.0/24). */
export const REAL_HNS = {
  id: "D9198B5B-3ABB-475A-874E-2B052F37CCD6",
  name: "0cb4b9bd5ce217f0d0df1330b37cf6db597569d1698fe48fdc7afa5c32b4e8c0",
  blob: Uint8Array.from(
    atob([
      "/v8EABIAAAALAAAAQQBjAHQAaQB2AGkAdAB5AEkAZAAAAFAgEckWHGNDgB4UCCynLngHABIA",
      "AAARAAAAQQBkAGQAaQB0AGkAbwBuAGEAbABQAGEAcgBhAG0AcwAAAP7//f8CABIAAAAVAAAA",
      "QwB1AHIAcgBlAG4AdABFAG4AZABwAG8AaQBuAHQAQwBvAHUAbgB0AAAAAAAAAAgAEgAAAAsA",
      "AABFAHgAdABlAG4AcwBpAG8AbgBzAAAAAwAAAP7/BAASAAAAAwAAAEkAZAAAAPCyw+fF899I",
      "rysQ/tbXLnoBABIAAAAKAAAASQBzAEUAbgBhAGIAbABlAGQAAAAAAAAABQASAAAABQAAAE4A",
      "YQBtAGUAAAAlAAAATQBpAGMAcgBvAHMAbwBmAHQAIABXAGkAbgBkAG8AdwBzACAARgBpAGwA",
      "dABlAHIAaQBuAGcAIABQAGwAYQB0AGYAbwByAG0AAAD9//7/BAASAAAAAwAAAEkAZAAAABsk",
      "T/cPRDNEuygA+J6tINgBABIAAAAKAAAASQBzAEUAbgBhAGIAbABlAGQAAAAAAAAABQASAAAA",
      "BQAAAE4AYQBtAGUAAAAsAAAATQBpAGMAcgBvAHMAbwBmAHQAIABBAHoAdQByAGUAIABWAEYA",
      "UAAgAFMAdwBpAHQAYwBoACAARgBpAGwAdABlAHIAIABFAHgAdABlAG4AcwBpAG8AbgAAAP3/",
      "/v8EABIAAAADAAAASQBkAAAA3doLQ7C6q0GjaZS2f6W+CgEAEgAAAAoAAABJAHMARQBuAGEA",
      "YgBsAGUAZAAAAAEAAAAFABIAAAAFAAAATgBhAG0AZQAAABcAAABNAGkAYwByAG8AcwBvAGYA",
      "dAAgAE4ARABJAFMAIABDAGEAcAB0AHUAcgBlAAAA/f8CABIAAAAGAAAARgBsAGEAZwBzAAAA",
      "CAAAAAQAMgAAAAMAAABJAEQAAABbixnZuzpaR4dOKwUvN8zWAQASAAAABQAAAEkAUAB2ADYA",
      "AAAAAAAABAASAAAACgAAAEwAYQB5AGUAcgBlAGQATwBuAAAACG0RPA50a0uKom6SR47aDAgA",
      "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",
    ].join("")),
    (c) => c.charCodeAt(0),
  ),
};
