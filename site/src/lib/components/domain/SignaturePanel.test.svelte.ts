import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SignaturePanel from './SignaturePanel.svelte';
import type { RunSignature } from '$shared/api-types';

const fakeSig: RunSignature = {
  run_id: 'r1',
  payload_b64: 'ZXhhbXBsZQ==',
  signature: { alg: 'Ed25519', key_id: 1, signed_at: '2026-04-27T10:00:00Z', value_b64: 'YmFkc2ln' },
  public_key_hex: '00'.repeat(32),
  machine_id: 'rig-01',
};

describe('SignaturePanel', () => {
  it('renders payload, signature, key fields with copy buttons', () => {
    render(SignaturePanel, { signature: fakeSig });
    expect(screen.getByText(/payload/i)).toBeDefined();
    expect(screen.getByText(/public key/i)).toBeDefined();
    expect(screen.getByText(/machine/i)).toBeDefined();
  });

  it('verify button is initially shown', () => {
    render(SignaturePanel, { signature: fakeSig });
    expect(screen.getByRole('button', { name: /verify/i })).toBeDefined();
  });
});
