// site/src/lib/shared/setup-submission.test.ts
import { describe, it, expect } from 'vitest';
import { parseSubmissionFields, isZip } from './setup-submission';

const TODAY = '2026-10-30';
const base = (): Record<string, string> => ({
  agent_tool: 'claude-code', base_model: 'opus', description: 'My setup',
  instructions_name: 'CLAUDE.md',
  roles_json: JSON.stringify([{ role: 'main', model: 'opus', effort: '' }]),
});

function errors(raw: Record<string, string>): Record<string, string> {
  const r = parseSubmissionFields(raw, TODAY);
  if (r.ok) throw new Error('expected errors');
  return r.errors as Record<string, string>;
}

describe('parseSubmissionFields', () => {
  it('accepts a valid minimal input and defaults visibility to public', () => {
    const r = parseSubmissionFields(base(), TODAY);
    expect(r).toEqual({
      ok: true,
      value: {
        agent_tool: 'claude-code', base_model: 'opus', description: 'My setup', visibility: 'public',
        instructions_name: 'CLAUDE.md', roles: [{ role: 'main', model: 'opus', effort: null }],
        flow: null, key: null, key_expires_on: null,
      },
    });
  });

  it('errors on each missing required field', () => {
    for (const f of ['agent_tool', 'base_model', 'description', 'instructions_name']) {
      const raw = base();
      delete raw[f];
      expect(errors(raw)[f], f).toBeTruthy();
    }
  });

  it('treats missing or empty roles as no roles', () => {
    const missing = base();
    delete missing.roles_json;
    for (const raw of [missing, { ...base(), roles_json: '[]' }]) {
      const r = parseSubmissionFields(raw, TODAY);
      expect(r.ok && r.value.roles).toEqual([]);
    }
  });

  it('rejects an invalid visibility', () => {
    expect(errors({ ...base(), visibility: 'secret' }).visibility).toBeTruthy();
    const r = parseSubmissionFields({ ...base(), visibility: 'private' }, TODAY);
    expect(r.ok && r.value.visibility).toBe('private');
  });

  it('rejects impossible calendar dates', () => {
    expect(errors({ ...base(), key: 'sk-abc', key_expires_on: '2026-02-30' }).key_expires_on).toBeTruthy();
  });

  it('rejects an unknown agent tool and instructions name', () => {
    expect(errors({ ...base(), agent_tool: 'vscode' }).agent_tool).toBeTruthy();
    expect(errors({ ...base(), instructions_name: 'README.md' }).instructions_name).toBeTruthy();
  });

  it('rejects a 201 character description', () => {
    expect(errors({ ...base(), description: 'x'.repeat(201) }).description).toBeTruthy();
  });

  it('rejects 13 roles, malformed roles_json and roles missing a model', () => {
    const role = { role: 'r', model: 'm', effort: null };
    expect(errors({ ...base(), roles_json: JSON.stringify(Array(13).fill(role)) }).roles).toBeTruthy();
    expect(errors({ ...base(), roles_json: '{nope' }).roles).toBeTruthy();
    expect(errors({ ...base(), roles_json: JSON.stringify([{ role: 'r', model: ' ', effort: null }]) }).roles).toBeTruthy();
  });

  it('caps base_model at 200 characters', () => {
    expect(errors({ ...base(), base_model: 'm'.repeat(201) }).base_model).toBeTruthy();
    expect(parseSubmissionFields({ ...base(), base_model: 'm'.repeat(200) }, TODAY).ok).toBe(true);
  });

  it('caps each role field at 100 characters', () => {
    const long = 'x'.repeat(101);
    for (const field of ['role', 'model', 'effort']) {
      const role = { role: 'r', model: 'm', effort: 'high', [field]: long };
      expect(errors({ ...base(), roles_json: JSON.stringify([role]) }).roles, field).toBeTruthy();
    }
    const ok = { role: 'x'.repeat(100), model: 'x'.repeat(100), effort: 'x'.repeat(100) };
    expect(parseSubmissionFields({ ...base(), roles_json: JSON.stringify([ok]) }, TODAY).ok).toBe(true);
  });

  it('caps the key at 4096 characters', () => {
    const k = { ...base(), key_expires_on: '2026-11-01' };
    expect(errors({ ...k, key: 'k'.repeat(4097) }).key).toBeTruthy();
    expect(parseSubmissionFields({ ...k, key: 'k'.repeat(4096) }, TODAY).ok).toBe(true);
  });

  it('limits key expiry to 7 days from today', () => {
    const k = { ...base(), key: 'sk-abc' };
    expect(errors({ ...k, key_expires_on: '2026-11-07' }).key_expires_on).toBeTruthy();
    expect(errors({ ...k, key_expires_on: '2026-10-29' }).key_expires_on).toBeTruthy();
    const ok = parseSubmissionFields({ ...k, key_expires_on: '2026-11-06' }, TODAY);
    expect(ok.ok).toBe(true);
  });

  it('requires an expiry with a key and ignores an expiry without one', () => {
    expect(errors({ ...base(), key: 'sk-abc' }).key_expires_on).toBeTruthy();
    const r = parseSubmissionFields({ ...base(), key_expires_on: '2026-11-01' }, TODAY);
    expect(r.ok && r.value.key_expires_on).toBeNull();
  });
});

describe('isZip', () => {
  it('detects zip magic bytes', () => {
    expect(isZip(new Uint8Array([0x50, 0x4b, 3, 4, 0]))).toBe(true);
    expect(isZip(new Uint8Array([0x50, 0x4b, 5, 6]))).toBe(true);
    expect(isZip(new TextEncoder().encode('%PDF-1.4'))).toBe(false);
  });
});
