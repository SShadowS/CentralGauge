<script lang="ts">
  import Badge from '$lib/components/ui/Badge.svelte';

  type Status = 'pending' | 'running' | 'completed' | 'failed';
  interface Props { status: Status; }
  let { status }: Props = $props();

  const variant = $derived(
    status === 'completed' ? 'success' :
    status === 'failed' ? 'danger' :
    status === 'running' ? 'warning' :
    'neutral'
  );
</script>

<Badge {variant}>{status}</Badge>
