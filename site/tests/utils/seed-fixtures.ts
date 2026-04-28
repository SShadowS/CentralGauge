/**
 * Pinned fixture identifiers — the literal slugs/IDs that every E2E spec
 * uses. Lifting these into a single module keeps P5.2/P5.3/P5.4 specs in
 * lockstep when the seed shape evolves; if `seedSmokeData` changes the
 * default model slug from `sonnet-4-7` to `sonnet-5-0`, every spec
 * rebuilds against the new constant via a single edit.
 *
 * Do not inline these constants back into specs. The whole point is that
 * a future plan can rename a slug here and every spec follows.
 */
export const FIXTURE = {
  family: {
    claude: 'claude',
    gpt: 'gpt',
  },
  model: {
    sonnet: 'sonnet-4-7',
    haiku: 'haiku-3-5',
    gpt5: 'gpt-5',
  },
  task: {
    easy1: 'CG-AL-E001',
    easy2: 'CG-AL-E002',
    medium1: 'CG-AL-M001',
    hard1: 'CG-AL-H001',
  },
  run: {
    /** First run created by seedSmokeData ({ runCount: 5 }) */
    run0: 'run-0000',
    run1: 'run-0001',
  },
  /** Search-FTS fixture: query that must produce a row with <mark> */
  searchKnownQuery: 'AL0132',
} as const;
