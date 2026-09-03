export interface GraphComponents {
  componentOf: Map<string, number>;
  sizes: number[]; // indexed by component id
  donorsOf: Map<string, string[]>;
}

export function buildComponents(
  tasks: { id: string; donors: string[] }[],
): GraphComponents {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let y = x;
    while (parent.get(y) !== r) {
      const n = parent.get(y)!;
      parent.set(y, r);
      y = n;
    }
    return r;
  };
  const donorsOf = new Map<string, string[]>();
  for (const t of tasks) {
    parent.set(t.id, t.id);
    donorsOf.set(t.id, [...t.donors]);
  }
  for (const t of tasks) {
    for (const d of t.donors) {
      if (!parent.has(d)) continue; // donor outside the set: no edge
      parent.set(find(d), find(t.id));
    }
  }
  const roots = new Map<string, number>();
  const componentOf = new Map<string, number>();
  const sizes: number[] = [];
  for (const t of [...tasks].sort((a, b) => a.id.localeCompare(b.id))) {
    const r = find(t.id);
    if (!roots.has(r)) {
      roots.set(r, sizes.length);
      sizes.push(0);
    }
    const cid = roots.get(r)!;
    componentOf.set(t.id, cid);
    sizes[cid]! += 1;
  }
  return { componentOf, sizes, donorsOf };
}

export interface SliceStats {
  task_count: number;
  donor_count: number;
  component_count: number;
  effective_components: number;
  largest_component_share: number;
}

/** Components intersected with the slice; a donor edge that leaves the slice does not connect. */
export function sliceStats(g: GraphComponents, sliceIds: string[]): SliceStats {
  const inSlice = new Set(sliceIds);
  // Two slice members that share a donor OUTSIDE the slice are still connected through it.
  const byOutsideDonor = new Map<string, string[]>();
  for (const id of sliceIds) {
    for (const d of g.donorsOf.get(id) ?? []) {
      if (inSlice.has(d)) continue;
      byOutsideDonor.set(d, [...(byOutsideDonor.get(d) ?? []), id]);
    }
  }
  const merged = buildComponents(
    sliceIds.map((id) => {
      const viaOutside: string[] = [];
      for (const [, members] of byOutsideDonor)
        if (members.includes(id))
          viaOutside.push(...members.filter((m) => m !== id));
      return {
        id,
        donors: [
          ...new Set([
            ...(g.donorsOf.get(id) ?? []).filter((d) => inSlice.has(d)),
            ...viaOutside,
          ]),
        ],
      };
    }),
  );
  const sizes = merged.sizes;
  const n = sliceIds.length;
  const sumSq = sizes.reduce((s, x) => s + x * x, 0);
  const donors = new Set<string>();
  for (const id of sliceIds)
    for (const d of g.donorsOf.get(id) ?? []) donors.add(d);
  return {
    task_count: n,
    donor_count: donors.size,
    component_count: sizes.length,
    effective_components: sumSq === 0 ? 0 : (n * n) / sumSq,
    largest_component_share: n === 0 ? 0 : Math.max(...sizes) / n,
  };
}
