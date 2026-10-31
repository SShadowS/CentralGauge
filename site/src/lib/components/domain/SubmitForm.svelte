<script lang="ts">
  import { onMount } from 'svelte';
  import { AGENT_TOOLS } from '$shared/setups';
  import { SUBMISSION_LIMITS } from '$shared/setup-submission';

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
  {#if banner}<p class="banner" role="alert">{banner}</p>{/if}

  <label for="agent_tool">Agent tool</label>
  <select id="agent_tool" name="agent_tool" aria-describedby={errors.agent_tool ? 'err-agent_tool' : undefined}>
    {#each AGENT_TOOLS as t (t)}<option value={t}>{t}</option>{/each}
  </select>
  {@render err('agent_tool')}

  <label for="base_model">Base model</label>
  <input id="base_model" name="base_model" type="text" required aria-describedby={errors.base_model ? 'err-base_model' : undefined} />
  {@render err('base_model')}

  <label for="description">Description</label>
  <input id="description" name="description" type="text" required maxlength={SUBMISSION_LIMITS.descriptionMax} aria-describedby={errors.description ? 'err-description' : undefined} />
  {@render err('description')}

  <fieldset>
    <legend>Visibility</legend>
    <label class="inline"><input type="radio" name="visibility" value="public" checked /> Public</label>
    <label class="inline"><input type="radio" name="visibility" value="private" /> Private</label>
    <p class="hint">Private: hidden from the chart unless a visitor turns it on, and the files are never shown.</p>
  </fieldset>
  {@render err('visibility')}

  <label for="instructions">Instructions file</label>
  <input id="instructions" name="instructions" type="file" accept=".md" required aria-describedby={errors.instructions ? 'err-instructions' : undefined} />
  {@render err('instructions')}

  <label for="instructions_name">Instructions file name</label>
  <select id="instructions_name" name="instructions_name">
    <option value="CLAUDE.md">CLAUDE.md</option>
    <option value="AGENTS.md">AGENTS.md</option>
  </select>
  {@render err('instructions_name')}

  <fieldset>
    <legend>Roles</legend>
    {#each roles as r, i (i)}
      <div class="role">
        <label>Role <input type="text" bind:value={r.role} /></label>
        <label>Model <input type="text" bind:value={r.model} /></label>
        <label>Effort <input type="text" bind:value={r.effort} /></label>
        <button type="button" onclick={() => roles.splice(i, 1)} aria-label="Remove role {i + 1}">Remove</button>
      </div>
    {/each}
    <button type="button" onclick={() => roles.push({ role: '', model: '', effort: '' })} disabled={roles.length >= SUBMISSION_LIMITS.rolesMax}>Add role</button>
    {@render err('roles')}
  </fieldset>

  <label for="flow">Flow</label>
  <textarea id="flow" name="flow" rows="5" maxlength={SUBMISSION_LIMITS.flowMax} aria-describedby={errors.flow ? 'err-flow' : undefined}></textarea>
  {@render err('flow')}

  <label for="zip">Setup zip</label>
  <input id="zip" name="zip" type="file" accept=".zip" required aria-describedby="zip-hint{errors.zip ? ' err-zip' : ''}" />
  <p class="hint" id="zip-hint">Up to 10 MiB.</p>
  {@render err('zip')}

  <label for="key">Key (optional)</label>
  <input id="key" name="key" type="password" autocomplete="off" aria-describedby="key-hint{errors.key ? ' err-key' : ''}" />
  {@render err('key')}
  <label for="key_expires_on">Key expires on</label>
  <input id="key_expires_on" name="key_expires_on" type="date" aria-describedby={errors.key_expires_on ? 'err-key_expires_on' : undefined} />
  {@render err('key_expires_on')}
  <p class="hint" id="key-hint">Use a key that expires within 7 days. Setups that need no key are preferred.</p>

  <div bind:this={widgetEl}></div>

  <button type="submit" disabled={busy}>{busy ? 'Submitting' : 'Submit setup'}</button>
</form>

<style>
  form { display: flex; flex-direction: column; gap: var(--space-2); max-width: 40rem; }
  label { font-weight: 600; margin-top: var(--space-3); }
  label.inline { font-weight: 400; margin-right: var(--space-4); }
  input[type='text'], input[type='password'], input[type='date'], select, textarea { padding: var(--space-2); font: inherit; }
  fieldset { border: 1px solid var(--border); border-radius: var(--radius-2); margin-top: var(--space-3); }
  .role { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: end; margin-bottom: var(--space-2); }
  .role label { margin-top: 0; }
  .hint { color: var(--text-muted); margin: 0; font-size: var(--text-sm); }
  .err { color: var(--danger, #b00020); margin: 0; font-size: var(--text-sm); }
  .banner { padding: var(--space-3) var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-2); }
  button[type='submit'] { margin-top: var(--space-4); align-self: flex-start; padding: var(--space-2) var(--space-4); }
</style>
