<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { SUBMISSION_LIMITS } from '$shared/setup-submission';
  import SubmissionStatusBadge from '$lib/components/domain/SubmissionStatusBadge.svelte';
  import Alert from '$lib/components/ui/Alert.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Radio from '$lib/components/ui/Radio.svelte';

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

<div class="page">
  <header class="head">
    <h1>Edit your submission</h1>
    {#if info}
      <div class="meta">
        <SubmissionStatusBadge status={info.status} />
        <span class="text-muted">{info.agent_tool} · <span class="text-mono">{info.base_model}</span></span>
      </div>
    {/if}
  </header>

  {#if !token}
    <Alert variant="warning">This link is missing its secret part.</Alert>
  {:else}
    {#if message}<Alert>{message}</Alert>{/if}
    {#if info}
      <p class="desc">{info.description}</p>

      <section class="group" aria-labelledby="sec-visibility">
        <h2 id="sec-visibility">Visibility</h2>
        <fieldset class="radios" aria-describedby={errors.visibility ? 'err-visibility' : undefined}>
          <legend class="sr-only">Visibility</legend>
          <Radio label="Public" name="visibility" value="public" bind:group={visibility} />
          <Radio label="Private" name="visibility" value="private" bind:group={visibility} />
        </fieldset>
        {#if errors.visibility}<p class="err" id="err-visibility">{errors.visibility}</p>{/if}
        <div><Button onclick={saveVisibility}>Save visibility</Button></div>
      </section>

      <form class="group" onsubmit={sendKey} aria-labelledby="sec-key">
        <h2 id="sec-key">Send a fresh key</h2>
        <p class="text-muted">{info.has_key ? `A key is on file, expiring ${info.key_expires_on}.` : 'No key is on file.'}</p>
        <div class="pair">
          <div class="field">
            <label for="key">Key</label>
            <input id="key" type="password" autocomplete="off" bind:value={key} maxlength={SUBMISSION_LIMITS.keyMax} required class="control mono" class:invalid={!!errors.key} aria-describedby="key-hint{errors.key ? ' err-key' : ''}" />
            {#if errors.key}<p class="err" id="err-key">{errors.key}</p>{/if}
          </div>
          <div class="field">
            <label for="key_expires_on">Key expires on</label>
            <input id="key_expires_on" type="date" bind:value={keyExpires} required class="control" class:invalid={!!errors.key_expires_on} aria-describedby={errors.key_expires_on ? 'err-key_expires_on' : undefined} />
            {#if errors.key_expires_on}<p class="err" id="err-key_expires_on">{errors.key_expires_on}</p>{/if}
          </div>
        </div>
        <p class="hint" id="key-hint">Use a key that expires within {SUBMISSION_LIMITS.keyMaxDays} days. Setups that need no key are preferred.</p>
        <div><Button type="submit" variant="primary">Send key</Button></div>
      </form>
    {/if}
  {/if}
</div>

<style>
  .page { max-width: var(--container-narrow); display: flex; flex-direction: column; gap: var(--space-5); }
  .head h1 { font-size: var(--text-3xl); line-height: var(--leading-3xl); }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-3);
    font-size: var(--text-sm);
  }
  .desc { font-size: var(--text-lg); line-height: var(--leading-lg); }
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-6);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface);
  }
  @media (max-width: 640px) { .group { padding: var(--space-5); } }
  .group h2 { font-size: var(--text-lg); line-height: var(--leading-lg); }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  .radios { display: flex; flex-wrap: wrap; gap: var(--space-6); }
  .pair { display: grid; grid-template-columns: 1fr; gap: var(--space-5); }
  @media (min-width: 640px) { .pair { grid-template-columns: 1fr 1fr; } }
  .field { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
  label { font-size: var(--text-sm); font-weight: var(--weight-medium); }
  .control {
    width: 100%;
    min-height: var(--input-h);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-elevated);
    color: var(--text);
    font-size: var(--text-base);
  }
  .control:hover { border-color: var(--border-strong); }
  .control:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
  .control.mono { font-family: var(--font-mono); }
  .control.invalid { border-color: var(--danger); }
  .hint { color: var(--text-muted); font-size: var(--text-sm); }
  .err { color: var(--danger); font-size: var(--text-sm); font-weight: var(--weight-medium); }
</style>
