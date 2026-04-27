<script lang="ts">
  type Status = 'connected' | 'reconnecting' | 'disconnected' | 'static';
  interface Props { status?: Status; label?: string; }
  let { status = 'static', label }: Props = $props();

  const dotClass = $derived(`dot status-${status}`);
  const text = $derived(label ?? (
    status === 'connected' ? 'live' :
    status === 'reconnecting' ? 'reconnecting…' :
    status === 'disconnected' ? 'offline' : ''
  ));
</script>

<span class="ind">
  <span class={dotClass} aria-hidden="true"></span>
  {#if text}<span class="text-muted">{text}</span>{/if}
</span>

<style>
  .ind { display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--text-xs); }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--text-faint); }
  .status-connected { background: var(--success); }
  .status-reconnecting { background: var(--warning); }
  .status-disconnected { background: var(--text-faint); }
  .status-static { background: var(--text-faint); }
</style>
