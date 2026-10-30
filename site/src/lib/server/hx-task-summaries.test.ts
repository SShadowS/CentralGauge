import { describe, expect, it } from 'vitest';
import { hxSummaryFrom, hxTaskSummary } from './hx-task-summaries';

const SHA = 'a'.repeat(64);
const md = `# Header\n\nintro text\n\n## HX-001\ndescription_sha: ${SHA}\n\nA short summary.\n`;

describe('hxSummaryFrom', () => {
  it('returns the body when the sha matches', () => {
    expect(hxSummaryFrom(md, 'HX-001', SHA)).toBe('A short summary.');
  });
  it('returns null on a sha mismatch, an unknown id, or an empty catalog', () => {
    expect(hxSummaryFrom(md, 'HX-001', 'b'.repeat(64))).toBeNull();
    expect(hxSummaryFrom(md, 'HX-002', SHA)).toBeNull();
    expect(hxSummaryFrom('', 'HX-001', SHA)).toBeNull();
  });
  it('the shipped catalog parses (no entry matches a made-up sha)', () => {
    expect(hxTaskSummary('HX-001', 'nope')).toBeNull();
  });
});
