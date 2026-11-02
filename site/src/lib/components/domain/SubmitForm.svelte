<script lang="ts">
  import { onMount } from 'svelte';
  import { AGENT_TOOLS } from '$shared/setups';
  import { SUBMISSION_LIMITS } from '$shared/setup-submission';
  import Alert from '$lib/components/ui/Alert.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Radio from '$lib/components/ui/Radio.svelte';

  interface Props {
    siteKey: string;
    onsubmitted: (result: { id: string; edit_path: string }) => void;
  }
  let { siteKey, onsubmitted }: Props = $props();

  interface TurnstileApi {
    render: (el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void; 'expired-callback'?: () => void }) => string;
    reset: (id?: string) => void;
  }
  const ts = () => (window as unknown as { turnstile?: TurnstileApi }).turnstile;

  let roles = $state<{ role: string; model: string; effort: string }[]>([]);
  let errors = $state<Record<string, string>>({});
  let banner = $state('');
  let busy = $state(false);
  let captchaToken = $state('');
  let widgetEl: HTMLElement | undefined = $state();
  let widgetId: string | undefined;

  function renderWidget() {
    const api = ts();
    if (!api || !widgetEl || widgetId !== undefined) return;
    widgetId = api.render(widgetEl, {
      sitekey: siteKey,
      callback: (t) => (captchaToken = t),
      'expired-callback': () => (captchaToken = ''),
    });
  }

  onMount(() => {
    if (ts()) return renderWidget();
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = renderWidget;
    document.head.appendChild(s);
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    banner = '';
    errors = {};
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    fd.set('roles_json', JSON.stringify(roles.filter((r) => r.role || r.model)));
    // The token travels in a header so the server can check it before reading the body.
    fd.delete('cf-turnstile-response');
    try {
      const res = await fetch('/api/v1/setup-submissions', {
        method: 'POST',
        body: fd,
        headers: { 'cf-turnstile-response': captchaToken },
      });
      const body = (await res.json().catch(() => ({}))) as { id: string; edit_path: string; error?: string; details?: Record<string, string> };
      if (res.status === 201) return onsubmitted(body);
      if (res.status === 400 && body.details) {
        errors = body.details;
        banner = 'Some fields need fixing.';
      } else {
        banner = body.error ?? 'Submission failed.';
      }
      ts()?.reset(widgetId);
      captchaToken = '';
    } catch {
      banner = 'Network error. Try again.';
    } finally {
      busy = false;
    }
  }
</script>

{#snippet err(name: string)}
  {#if errors[name]}<p class="err" id="err-{name}">{errors[name]}</p>{/if}
{/snippet}

<form onsubmit={submit}>
  {#if banner}<Alert variant="error">{banner}</Alert>{/if}

  <section class="group" aria-labelledby="sec-basics">
    <h2 id="sec-basics">Setup</h2>
    <div class="field">
      <label for="agent_tool">Agent tool</label>
      <select id="agent_tool" name="agent_tool" class="control" class:invalid={!!errors.agent_tool} aria-describedby={errors.agent_tool ? 'err-agent_tool' : undefined}>
        {#each AGENT_TOOLS as t (t)}<option value={t}>{t}</option>{/each}
      </select>
      {@render err('agent_tool')}
    </div>
    <div class="field">
      <label for="base_model">Base model</label>
      <input id="base_model" name="base_model" type="text" required class="control mono" class:invalid={!!errors.base_model} aria-describedby="base_model-hint{errors.base_model ? ' err-base_model' : ''}" />
      <p class="hint" id="base_model-hint">The model that runs the main agent.</p>
      {@render err('base_model')}
    </div>
    <div class="field">
      <label for="description">Description</label>
      <input id="description" name="description" type="text" required maxlength={SUBMISSION_LIMITS.descriptionMax} class="control" class:invalid={!!errors.description} aria-describedby={errors.description ? 'err-description' : 'description-hint'} />
      {#if !errors.description}<p class="hint" id="description-hint">One line, up to {SUBMISSION_LIMITS.descriptionMax} characters. Shown as the setup name.</p>{/if}
      {@render err('description')}
    </div>
  </section>

  <section class="group" aria-labelledby="sec-instructions">
    <h2 id="sec-instructions">Instructions</h2>
    <div class="pair">
      <div class="field">
        <label for="instructions">Instructions file</label>
        <input id="instructions" name="instructions" type="file" accept=".md" required class="control file" class:invalid={!!errors.instructions} aria-describedby="instructions-hint{errors.instructions ? ' err-instructions' : ''}" />
        <p class="hint" id="instructions-hint">A Markdown file.</p>
        {@render err('instructions')}
      </div>
      <div class="field">
        <label for="instructions_name">Instructions file name</label>
        <select id="instructions_name" name="instructions_name" class="control" class:invalid={!!errors.instructions_name} aria-describedby={errors.instructions_name ? 'err-instructions_name' : undefined}>
          <option value="CLAUDE.md">CLAUDE.md</option>
          <option value="AGENTS.md">AGENTS.md</option>
        </select>
        {@render err('instructions_name')}
      </div>
    </div>
  </section>

  <section class="group" aria-labelledby="sec-roles">
    <h2 id="sec-roles">Roles and flow</h2>
    <fieldset class="roles" aria-describedby="roles-hint{errors.roles ? ' err-roles' : ''}">
      <legend>Roles</legend>
      <p class="hint" id="roles-hint">Optional. One row per agent role, for example planner or reviewer, up to {SUBMISSION_LIMITS.rolesMax}.</p>
      {#each roles as r, i (i)}
        <div class="role">
          <label class="sub">Role <input type="text" class="control" bind:value={r.role} /></label>
          <label class="sub">Model <input type="text" class="control mono" bind:value={r.model} /></label>
          <label class="sub">Effort <input type="text" class="control" bind:value={r.effort} /></label>
          <Button size="sm" variant="ghost" onclick={() => roles.splice(i, 1)}>Remove<span class="sr-only"> role {i + 1}</span></Button>
        </div>
      {/each}
      <div>
        <Button size="sm" onclick={() => roles.push({ role: '', model: '', effort: '' })} disabled={roles.length >= SUBMISSION_LIMITS.rolesMax}>Add role</Button>
      </div>
      {@render err('roles')}
    </fieldset>
    <div class="field">
      <label for="flow">Flow</label>
      <textarea id="flow" name="flow" rows="5" maxlength={SUBMISSION_LIMITS.flowMax} class="control" class:invalid={!!errors.flow} aria-describedby="flow-hint{errors.flow ? ' err-flow' : ''}"></textarea>
      <p class="hint" id="flow-hint">Optional. How the roles hand work to each other.</p>
      {@render err('flow')}
    </div>
  </section>

  <section class="group" aria-labelledby="sec-files">
    <h2 id="sec-files">Setup files</h2>
    <div class="field">
      <label for="zip">Setup zip</label>
      <input id="zip" name="zip" type="file" accept=".zip" required class="control file" class:invalid={!!errors.zip} aria-describedby="zip-hint{errors.zip ? ' err-zip' : ''}" />
      <p class="hint" id="zip-hint">Up to 10 MiB.</p>
      {@render err('zip')}
    </div>
  </section>

  <section class="group" aria-labelledby="sec-key">
    <h2 id="sec-key">Key</h2>
    <p class="hint" id="key-hint">Use a key that expires within 7 days. Setups that need no key are preferred.</p>
    <div class="pair">
      <div class="field">
        <label for="key">Key (optional)</label>
        <input id="key" name="key" type="password" autocomplete="off" class="control mono" class:invalid={!!errors.key} aria-describedby="key-hint{errors.key ? ' err-key' : ''}" />
        {@render err('key')}
      </div>
      <div class="field">
        <label for="key_expires_on">Key expires on</label>
        <input id="key_expires_on" name="key_expires_on" type="date" class="control" class:invalid={!!errors.key_expires_on} aria-describedby={errors.key_expires_on ? 'err-key_expires_on' : undefined} />
        {@render err('key_expires_on')}
      </div>
    </div>
  </section>

  <section class="group" aria-labelledby="sec-visibility">
    <h2 id="sec-visibility">Visibility</h2>
    <fieldset class="radios" aria-describedby="visibility-hint{errors.visibility ? ' err-visibility' : ''}">
      <legend class="sr-only">Visibility</legend>
      <Radio label="Public" name="visibility" value="public" group="public" />
      <Radio label="Private" name="visibility" value="private" group="public" />
    </fieldset>
    <p class="hint" id="visibility-hint">Private: hidden from the chart unless a visitor turns it on, and the files are never shown.</p>
    {@render err('visibility')}
  </section>

  <div class="submit">
    <div bind:this={widgetEl}></div>
    <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Submitting' : 'Submit setup'}</Button>
  </div>
</form>

<style>
  form { display: flex; flex-direction: column; gap: var(--space-5); }
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
  .field { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
  .pair { display: grid; grid-template-columns: 1fr; gap: var(--space-5); }
  @media (min-width: 640px) { .pair { grid-template-columns: 1fr 1fr; } }

  label, legend { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text); }
  label.sub { display: flex; flex-direction: column; gap: var(--space-2); flex: 1 1 8rem; min-width: 0; }

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
  textarea.control { resize: vertical; line-height: var(--leading-base); }
  .control.file { padding: var(--space-2); font-size: var(--text-sm); }
  .control.file::file-selector-button {
    margin-right: var(--space-4);
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-weight: var(--weight-medium);
    cursor: pointer;
  }
  .control.file:hover::file-selector-button { border-color: var(--border-strong); }

  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  .roles { display: flex; flex-direction: column; gap: var(--space-4); }
  .role {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    align-items: flex-end;
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--bg);
  }
  .radios { display: flex; flex-wrap: wrap; gap: var(--space-6); }

  .hint { color: var(--text-muted); font-size: var(--text-sm); }
  .err { color: var(--danger); font-size: var(--text-sm); font-weight: var(--weight-medium); }

  .submit { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-4); }
</style>
