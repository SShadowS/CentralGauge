<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import MarkdownRenderer from '$lib/components/domain/MarkdownRenderer.svelte';
  import SubmissionStatusBadge from '$lib/components/domain/SubmissionStatusBadge.svelte';
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
  // Navigating between submissions reuses this component; drop the old key.
  $effect(() => {
    void s.id;
    revealed = null;
    copied = false;
  });

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

  const deleteKey = () => {
    if (!confirm('Delete the stored key? This cannot be undone.')) return;
    return deleteKeyNow();
  };

  const deleteKeyNow = () => run(async () => {
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

<Breadcrumbs crumbs={[{ label: 'Submissions', href: '/admin/submissions' }, { label: s.id }]} />

<header class="head">
  <h1>{s.description}</h1>
  <div class="meta">
    <SubmissionStatusBadge status={s.status} />
    <span class="text-muted">{s.agent_tool} · <span class="text-mono">{s.base_model}</span> · {s.visibility}</span>
  </div>
</header>

<div class="layout">
  <div class="content">
    <section>
      <h2>Roles</h2>
      {#if s.roles.length === 0}
        <p class="text-muted">None.</p>
      {:else}
        <div class="wrap">
          <table>
            <thead><tr><th scope="col">Role</th><th scope="col">Model</th><th scope="col">Effort</th></tr></thead>
            <tbody>
              {#each s.roles as r}
                <tr><td>{r.role}</td><td class="text-mono">{r.model}</td><td>{r.effort ?? 'default'}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <section>
      <h2>Flow</h2>
      {#if s.flow}<p class="flow">{s.flow}</p>{:else}<p class="text-muted">None.</p>{/if}
    </section>

    <section>
      <h2>Instructions <span class="text-muted text-mono file">{s.instructions_name}</span></h2>
      <div class="doc">
        <!-- MarkdownRenderer sanitises -->
        <MarkdownRenderer source={s.instructions_md} />
      </div>
    </section>
  </div>

  <aside class="side">
    <section class="panel" aria-labelledby="h-details">
      <h2 id="h-details">Details</h2>
      <dl>
        <dt>Id</dt><dd class="text-mono">{s.id}</dd>
        <dt>Created</dt><dd class="tabular">{s.created_at}</dd>
        <dt>Key</dt><dd>{s.has_key ? `stored, expires ${s.key_expires_on ?? 'never'}` : 'none'}</dd>
        <dt>Zip</dt><dd>{s.zip_bytes} bytes</dd>
        <dt>SHA-256</dt><dd class="text-mono hash">{s.zip_sha256}</dd>
        <dt>Setup</dt><dd>{s.setup_id ?? 'none'}</dd>
        <dt>Reviewed</dt><dd>{s.reviewed_at ?? 'not yet'}{s.review_note ? `: ${s.review_note}` : ''}</dd>
      </dl>
      <div><Button size="sm" onclick={download} disabled={busy}>Download zip</Button></div>
    </section>

    {#if s.has_key}
      <section class="panel" aria-labelledby="h-key">
        <h2 id="h-key">Key</h2>
        <p class="hint">Revealing the key is logged in the audit trail.</p>
        <div class="row">
          <Button size="sm" onclick={reveal} disabled={busy}>Reveal key</Button>
          <Button size="sm" onclick={deleteKey} disabled={busy} variant="danger">Delete key</Button>
        </div>
        {#if revealed !== null}
          <label class="field">
            Submitter key
            <input class="control mono" type="text" readonly value={revealed} />
          </label>
          <div><Button size="sm" onclick={copy} disabled={busy}>{copied ? 'Copied' : 'Copy key'}</Button></div>
        {/if}
      </section>
    {/if}

    <section class="panel" aria-labelledby="h-review">
      <h2 id="h-review">Review</h2>
      <label class="field">
        Review note
        <textarea class="control" bind:value={note} rows="3" disabled={busy}></textarea>
      </label>
      <div class="row">
        <Button variant="primary" onclick={() => review('approved')} disabled={busy}>Approve</Button>
        <Button onclick={() => review('rejected')} disabled={busy} variant="danger">Reject</Button>
      </div>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </section>
  </aside>
</div>

<style>
  .head { margin-top: var(--space-4); }
  .head h1 { font-size: var(--text-3xl); line-height: var(--leading-3xl); overflow-wrap: anywhere; }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-3);
    font-size: var(--text-sm);
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: var(--space-7);
    margin-top: var(--space-6);
    align-items: start;
  }
  @media (max-width: 1024px) { .layout { grid-template-columns: minmax(0, 1fr); } }

  .content { min-width: 0; }
  .content > section + section { margin-top: var(--space-7); }
  h2 { font-size: var(--text-xl); margin-bottom: var(--space-4); }
  .file { font-size: var(--text-sm); font-weight: var(--weight-regular); }
  .flow { white-space: pre-wrap; }
  .doc {
    padding: var(--space-5) var(--space-6);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    overflow-x: auto;
  }

  .wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius-2); }
  thead { background: var(--surface); }
  th, td { text-align: left; padding: var(--space-3) var(--space-5); border-bottom: 1px solid var(--border); font-size: var(--text-sm); }
  th { font-weight: var(--weight-semi); color: var(--text-muted); }
  tbody tr:last-child td { border-bottom: 0; }

  .side { display: flex; flex-direction: column; gap: var(--space-5); min-width: 0; }
  @media (min-width: 1025px) { .side { position: sticky; top: calc(var(--nav-h) + var(--space-5)); } }
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface);
  }
  .panel h2 { font-size: var(--text-lg); margin: 0; }
  dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--space-3) var(--space-5); margin: 0; font-size: var(--text-sm); }
  dt { color: var(--text-muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
  .hash { font-size: var(--text-xs); }
  .row { display: flex; flex-wrap: wrap; gap: var(--space-3); }
  .hint { color: var(--text-muted); font-size: var(--text-sm); }
  .field { display: flex; flex-direction: column; gap: var(--space-2); font-size: var(--text-sm); font-weight: var(--weight-medium); }
  .control {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-elevated);
    color: var(--text);
    font-size: var(--text-base);
    font-weight: var(--weight-regular);
  }
  .control:hover { border-color: var(--border-strong); }
  .control:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
  .control.mono { font-family: var(--font-mono); font-size: var(--text-sm); }
  textarea.control { resize: vertical; }
  .error { color: var(--danger); font-size: var(--text-sm); }
</style>
