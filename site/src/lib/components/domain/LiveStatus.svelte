<script lang="ts">
  import StatusIndicator from './StatusIndicator.svelte';
  import type { EventSourceHandle } from '$lib/client/use-event-source.svelte';

  interface Props {
    sse: EventSourceHandle;
    label?: string;
    onReconnect?: () => void;
  }

  let { sse, label, onReconnect }: Props = $props();

  const status = $derived(
    sse.status === 'connected' ? 'connected' :
    sse.status === 'reconnecting' || sse.status === 'connecting' ? 'reconnecting' :
    'disconnected'
  );

  const text = $derived(label ?? (
    status === 'connected' ? 'live' :
    status === 'reconnecting' ? 'reconnecting…' :
    'offline'
  ));
</script>

<span class="live-status">
  <StatusIndicator status={status} label={text} />
  {#if status === 'disconnected'}
    <button type="button" class="reconnect-btn" onclick={onReconnect}>Reconnect</button>
  {/if}
</span>

<style>
  .live-status { display: inline-flex; align-items: center; gap: var(--space-3); }
  .reconnect-btn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: 0 var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-muted);
    cursor: pointer;
    height: 22px;
  }
  .reconnect-btn:hover { color: var(--text); border-color: var(--border-strong); }
</style>
