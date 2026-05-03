<script lang="ts">
  import type { RunSignature } from '$shared/api-types';
  import Button from '$lib/components/ui/Button.svelte';
  import Code from '$lib/components/ui/Code.svelte';
  import CopyButton from './CopyButton.svelte';
  import { Lock, CheckCircle, AlertCircle } from '$lib/components/ui/icons';

  interface Props { signature: RunSignature; }
  let { signature }: Props = $props();

  type VerifyState = 'idle' | 'verifying' | 'valid' | 'invalid' | 'error';
  let verifyState: VerifyState = $state('idle');
  let errorMsg = $state('');

  function hexToBytes(hex: string): Uint8Array {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }

  function b64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function verify() {
    verifyState = 'verifying';
    try {
      const ed = await import('@noble/ed25519');
      const message = b64ToBytes(signature.payload_b64);
      const sig = b64ToBytes(signature.signature.value_b64);
      const pub = hexToBytes(signature.public_key_hex);
      const ok = await ed.verifyAsync(sig, message, pub);
      verifyState = ok ? 'valid' : 'invalid';
    } catch (err) {
      verifyState = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<div class="panel">
  <header>
    <Lock size={16} />
    <h3>Signature</h3>
  </header>

  <dl>
    <dt>Run ID</dt>
    <dd class="text-mono">{signature.run_id}</dd>

    <dt>Algorithm</dt>
    <dd>{signature.signature.alg}</dd>

    <dt>Key ID</dt>
    <dd class="text-mono">{signature.signature.key_id}</dd>

    <dt>Machine</dt>
    <dd class="text-mono">{signature.machine_id}</dd>

    <dt>Signed at</dt>
    <dd class="text-mono">{signature.signature.signed_at}</dd>

    <dt>Public key (hex)</dt>
    <dd class="row">
      <Code>{signature.public_key_hex}</Code>
      <CopyButton value={signature.public_key_hex} label="Copy public key" />
    </dd>

    <dt>Signature (b64)</dt>
    <dd class="row">
      <Code>{signature.signature.value_b64}</Code>
      <CopyButton value={signature.signature.value_b64} label="Copy signature" />
    </dd>

    <dt>Payload (b64)</dt>
    <dd class="row">
      <Code block>{signature.payload_b64}</Code>
      <CopyButton value={signature.payload_b64} label="Copy payload" />
    </dd>
  </dl>

  <div class="verify">
    <Button onclick={verify} variant="primary" disabled={verifyState === 'verifying'}>
      {#if verifyState === 'idle' || verifyState === 'verifying'}
        Verify in browser
      {:else if verifyState === 'valid'}
        <CheckCircle size={14} /> Re-verify
      {:else}
        <AlertCircle size={14} /> Re-verify
      {/if}
    </Button>
    {#if verifyState === 'verifying'}
      <span class="text-muted">verifying…</span>
    {:else if verifyState === 'valid'}
      <span class="ok">✓ Signature valid (Ed25519)</span>
    {:else if verifyState === 'invalid'}
      <span class="bad">✗ Signature INVALID, does not match public key</span>
    {:else if verifyState === 'error'}
      <span class="bad">verify failed: {errorMsg}</span>
    {/if}
  </div>
</div>

<style>
  .panel {
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-5);
    background: var(--surface);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
  }
  h3 { margin: 0; font-size: var(--text-base); }

  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-3) var(--space-6);
    font-size: var(--text-sm);
    margin: 0;
  }
  dt { color: var(--text-muted); }
  dd { margin: 0; }
  .row { display: flex; align-items: flex-start; gap: var(--space-3); }
  .row :global(code), .row :global(pre) { flex: 1; word-break: break-all; }

  .verify {
    margin-top: var(--space-5);
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }
  .ok { color: var(--success); font-weight: var(--weight-medium); }
  .bad { color: var(--danger); font-weight: var(--weight-medium); }
</style>
