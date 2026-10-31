<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import MarkdownRenderer from '$lib/components/domain/MarkdownRenderer.svelte';
  import Button from '$lib/components/ui/Button.svelte';

  let { data } = $props();
  const s = $derived(data.submission);
  const base = $derived(`/api/v1/admin/setup-submissions/${encodeURIComponent(s.id)}`);

  let note = $state('');
  let busy = $state(false);
  let error = $state('');
  // The revealed key lives only here; never in the URL or storage.
  let revealed = $state<string | null>(null);
  let copied = $state(false);

  onDestroy(() => { revealed = null; });

  async function post(path: string, body: object = {}): Promise<Response> {
    const r = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({} as Record<string, unknown>));
      throw new Error((b as { error?: string }).error ?? `HTTP ${r.status}`);
    }
    return r;
  }

  async function run(fn: () => Promise<void>) {
    busy = true;
    error = '';
    try {
      await fn();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  const reveal = () => run(async () => {
    const r = await post('/key');
    revealed = ((await r.json()) as { key: string }).key;
    copied = false;
  });

  const copy = () => run(async () => {
    await navigator.clipboard.writeText(revealed ?? '');
    copied = true;
  });

  const review = (status: 'approved' | 'rejected') => run(async () => {
    await post('/review', { status, note: note.trim() || undefined });
    if (status === 'rejected') revealed = null;
    await invalidateAll();
  });

  const deleteKey = () => run(async () => {
    await post('/delete-key');
    revealed = null;
    await invalidateAll();
  });

  const download = () => run(async () => {
    const r = await post('/zip');
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `${s.id}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
</script>

<svelte:head><title>Submission {s.id} · Admin · CentralGauge</title></svelte:head>

<p><a href="/admin/submissions">Back to submissions</a></p>
<h1>{s.description}</h1>

<dl>
  <dt>Id</dt><dd>{s.id}</dd>
  <dt>Status</dt><dd>{s.status}</dd>
  <dt>Created</dt><dd>{s.created_at}</dd>
  <dt>Tool</dt><dd>{s.agent_tool}</dd>
  <dt>Base model</dt><dd>{s.base_model}</dd>
  <dt>Visibility</dt><dd>{s.visibility}</dd>
  <dt>Key</dt><dd>{s.has_key ? `stored, expires ${s.key_expires_on ?? 'never'}` : 'none'}</dd>
  <dt>Zip</dt><dd>{s.zip_bytes} bytes, sha256 {s.zip_sha256}</dd>
  <dt>Setup</dt><dd>{s.setup_id ?? 'none'}</dd>
  <dt>Reviewed</dt><dd>{s.reviewed_at ?? 'not yet'}{s.review_note ? `: ${s.review_note}` : ''}</dd>
</dl>

<section>
  <h2>Roles</h2>
  <table>
    <thead><tr><th>Role</th><th>Model</th><th>Effort</th></tr></thead>
    <tbody>
      {#each s.roles as r}
        <tr><td>{r.role}</td><td>{r.model}</td><td>{r.effort ?? 'default'}</td></tr>
      {/each}
    </tbody>
  </table>
</section>

<section>
  <h2>Flow</h2>
  {#if s.flow}<p class="flow">{s.flow}</p>{:else}<p class="text-muted">None.</p>{/if}
</section>

<section>
  <h2>Instructions ({s.instructions_name})</h2>
  <!-- MarkdownRenderer sanitises -->
  <MarkdownRenderer source={s.instructions_md} />
</section>

<section class="actions">
  <h2>Actions</h2>
  <Button onclick={download} disabled={busy}>Download zip</Button>

  {#if s.has_key}
    <div>
      <Button onclick={reveal} disabled={busy}>Reveal key</Button>
      <span class="text-muted">Revealing the key is logged in the audit trail.</span>
    </div>
    {#if revealed !== null}
      <label>
        Submitter key
        <input type="text" readonly value={revealed} />
      </label>
      <Button onclick={copy} disabled={busy}>{copied ? 'Copied' : 'Copy key'}</Button>
    {/if}
    <Button onclick={deleteKey} disabled={busy} variant="danger">Delete key</Button>
  {/if}

  <label>
    Review note
    <textarea bind:value={note} rows="3" disabled={busy}></textarea>
  </label>
  <div>
    <Button onclick={() => review('approved')} disabled={busy}>Approve</Button>
    <Button onclick={() => review('rejected')} disabled={busy} variant="danger">Reject</Button>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  dl { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-1) var(--space-4); }
  dt { font-weight: bold; }
  dd { margin: 0; overflow-wrap: anywhere; }
  .flow { white-space: pre-wrap; }
  table { border-collapse: collapse; }
  th, td { text-align: left; padding: var(--space-2); border-bottom: 1px solid var(--border); }
  .actions { display: flex; flex-direction: column; gap: var(--space-3); align-items: flex-start; }
  label { display: flex; flex-direction: column; gap: var(--space-1); }
  input[readonly] { font-family: var(--font-mono); min-width: 320px; }
  textarea { min-width: 320px; }
  .error { color: var(--danger); }
</style>
