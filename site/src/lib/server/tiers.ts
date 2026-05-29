/**
 * Paired-bootstrap statistical tiering.
 *
 * Given per-(model, task) scores aligned by task index over the SHARED task
 * set, assign each model a 1-based tier. Models in the same tier are not
 * distinguishable: the 95% bootstrap CI of their paired mean difference
 * includes 0. All models must share the same task ordering (same length).
 *
 * Deterministic: resampling uses a seeded xorshift RNG (Math.random is
 * unavailable in this runtime and would break reproducibility/tests).
 */

export interface TierInput {
  slug: string;
  /** AUC scores in [0,1] aligned by task index. 0 / 0.5 / 1 for AUC@2. */
  scores: number[];
}

export interface TierResult {
  slug: string;
  /** Observed mean score over the task set. */
  mean: number;
  /** 1-based tier; 1 = top. */
  tier: number;
}

export interface TierOptions {
  /** Seed string (use the task-set hash) for deterministic resampling. */
  seed: string;
  /** Bootstrap resamples. Default 2000. */
  iterations?: number;
  /** Two-sided alpha. Default 0.05 (→ 2.5%/97.5% diff CI). */
  alpha?: number;
}

/** Deterministic 32-bit string hash → seed. */
function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}

/** xorshift32 PRNG → next uint32. */
function makeRng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x >>> 0;
  };
}

function mean(v: number[]): number {
  let s = 0;
  for (const x of v) s += x;
  return v.length ? s / v.length : 0;
}

/**
 * Returns true if model i and model j are statistically distinguishable:
 * the (1-alpha) CI of the paired bootstrap difference (i - j) excludes 0.
 */
function distinguishable(
  a: number[],
  b: number[],
  rng: () => number,
  iterations: number,
  alpha: number,
): boolean {
  const n = a.length;
  const diffs = new Float64Array(iterations);
  for (let it = 0; it < iterations; it++) {
    let sa = 0;
    let sb = 0;
    for (let k = 0; k < n; k++) {
      // Paired: same resampled task index feeds both models.
      const idx = rng() % n;
      sa += a[idx];
      sb += b[idx];
    }
    diffs[it] = (sa - sb) / n;
  }
  const sorted = Array.from(diffs).sort((x, y) => x - y);
  const lo = sorted[Math.floor((alpha / 2) * iterations)];
  const hi = sorted[Math.min(iterations - 1, Math.floor((1 - alpha / 2) * iterations))];
  // Distinguishable when the whole CI is on one side of 0.
  return lo > 0 || hi < 0;
}

export function computeTiers(input: TierInput[], opts: TierOptions): TierResult[] {
  const iterations = opts.iterations ?? 2000;
  const alpha = opts.alpha ?? 0.05;

  // Sort models by observed mean, descending.
  const ranked = input
    .map((m) => ({ slug: m.slug, scores: m.scores, mean: mean(m.scores) }))
    .sort((p, q) => q.mean - p.mean || p.slug.localeCompare(q.slug));

  const out: TierResult[] = [];
  let tier = 1;
  let anchorIdx = 0; // top model of the current tier

  for (let i = 0; i < ranked.length; i++) {
    if (i === 0) {
      out.push({ slug: ranked[0].slug, mean: ranked[0].mean, tier });
      continue;
    }
    // Fresh RNG per comparison, seeded by (seed, anchor, candidate) so the
    // whole assignment is deterministic regardless of evaluation order.
    const rng = makeRng(
      hashSeed(`${opts.seed}:${ranked[anchorIdx].slug}:${ranked[i].slug}`),
    );
    const isWorse = distinguishable(
      ranked[anchorIdx].scores,
      ranked[i].scores,
      rng,
      iterations,
      alpha,
    );
    if (isWorse) {
      tier += 1;
      anchorIdx = i; // new tier anchored on this model
    }
    out.push({ slug: ranked[i].slug, mean: ranked[i].mean, tier });
  }
  return out;
}
