<script lang="ts">
  // Outlined Tag rather than the solid Badge: white text on the dark-theme
  // success/warning fills falls below AA contrast.
  import Tag from '$lib/components/ui/Tag.svelte';

  interface Props { status: string; }
  let { status }: Props = $props();

  const variant = $derived(
    status === 'approved' ? 'success' :
    status === 'rejected' ? 'danger' :
    status === 'new' ? 'accent' :
    'neutral'
  );
</script>

<Tag {variant}>{status}</Tag>
