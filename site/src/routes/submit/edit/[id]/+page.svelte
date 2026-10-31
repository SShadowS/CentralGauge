<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { SUBMISSION_LIMITS } from '$shared/setup-submission';

  interface Status {
    id: string; status: string; created_at: string; agent_tool: string; base_model: string;
    description: string; visibility: 'public' | 'private'; has_key: boolean;
    key_expires_on: string | null; setup_id: string | null;
  }

  // The secret stays in memory only: read once from the fragment, sent in the JSON body.
  let token = $state('');
  let info = $state<Status | null>(null);
  let message = $state('');
  let errors = $state<Record<string, string>>({});
  let visibility = $state<'public' | 'private'>('public');
  let key = $state('');
  let keyExpires = $state('');

  async function call(path: 'status' | 'edit', extra: Record<string, unknown> = {}) {
    errors = {};
    message = '';
    let res: Response;
    try {
      res = await fetch(`/api/v1/setup-submissions/${page.params.id}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, ...extra }),
      });
    } catch {
      message = 'Network error. Reload the page to try again.';
      return false;
    }
    const body = (await res.json().catch(() => ({}))) as Status & { error?: string; details?: Record<string, string> };
    if (res.ok) {
      info = body;
      visibility = body.visibility;
      return true;
    }
    if (res.status === 400 && body.details) errors = body.details;
    message = res.status === 404 ? 'This link is not valid.' : (body.error ?? 'Request failed.');
    return false;
  }

  onMount(async () => {
    token = location.hash.slice(1);
    if (token) await call('status');
  });

  async function saveVisibility() {
    if (await call('edit', { visibility })) message = 'Visibility saved.';
  }

  async function sendKey(e: SubmitEvent) {
    e.preventDefault();
    if (await call('edit', { key, key_expires_on: keyExpires })) {
      key = '';
      message = 'Key received.';
    }
  }
</script>

<svelte:head>
  <title>Edit submission · CentralGauge</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<h1>Edit your submission</h1>

{#if !token}
  <p>This link is missing its secret part.</p>
{:else}
  {#if message}<p class="banner" role="status">{message}</p>{/if}
  {#if info}
    <p>Status: <strong>{info.status}</strong></p>
    <p>{info.description} ({info.agent_tool}, {info.base_model})</p>

    <fieldset>
      <legend>Visibility</legend>
      <label class="inline"><input type="radio" bind:group={visibility} value="public" /> Public</label>
      <label class="inline"><input type="radio" bind:group={visibility} value="private" /> Private</label>
      <button type="button" onclick={saveVisibility}>Save visibility</button>
      {#if errors.visibility}<p class="err">{errors.visibility}</p>{/if}
    </fieldset>

    <form onsubmit={sendKey}>
      <h2>Send a fresh key</h2>
      <p>{info.has_key ? `A key is on file, expiring ${info.key_expires_on}.` : 'No key is on file.'}</p>
      <label for="key">Key</label>
      <input id="key" type="password" autocomplete="off" bind:value={key} maxlength={SUBMISSION_LIMITS.keyMax} required />
      {#if errors.key}<p class="err">{errors.key}</p>{/if}
      <label for="key_expires_on">Key expires on</label>
      <input id="key_expires_on" type="date" bind:value={keyExpires} required />
      {#if errors.key_expires_on}<p class="err">{errors.key_expires_on}</p>{/if}
      <p class="hint">Use a key that expires within {SUBMISSION_LIMITS.keyMaxDays} days. Setups that need no key are preferred.</p>
      <button type="submit">Send key</button>
    </form>
  {/if}
{/if}

<style>
  form, fieldset { display: flex; flex-direction: column; gap: var(--space-2); max-width: 32rem; margin-top: var(--space-4); }
  fieldset { border: 1px solid var(--border); border-radius: var(--radius-2); }
  label.inline { margin-right: var(--space-4); }
  .hint { color: var(--text-muted); margin: 0; }
  .err { color: var(--danger, #b00020); margin: 0; }
  .banner { padding: var(--space-3) var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-2); }
  button { align-self: flex-start; padding: var(--space-2) var(--space-4); }
</style>
