<script lang="ts">
  import { page } from '$app/state';
  import SubmitForm from '$lib/components/domain/SubmitForm.svelte';
  import CopyButton from '$lib/components/domain/CopyButton.svelte';

  let { data } = $props();
  let editUrl = $state('');

  function done(r: { id: string; edit_path: string }) {
    editUrl = new URL(r.edit_path, page.url.origin).href;
  }
</script>

<svelte:head>
  <title>Submit a setup · CentralGauge</title>
</svelte:head>

<h1>Submit a setup</h1>

{#if editUrl}
  <p>Your setup was received and will be reviewed.</p>
  <p>Save this link. It is the only way to change visibility or send a fresh key, and it cannot be recovered.</p>
  <p><code>{editUrl}</code> <CopyButton value={editUrl} label="Copy edit link" /></p>
{:else}
  <SubmitForm siteKey={data.siteKey} onsubmitted={done} />
{/if}
