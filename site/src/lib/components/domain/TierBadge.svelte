<script lang="ts">
  import Badge from '$lib/components/ui/Badge.svelte';
  import { Check } from '$lib/components/ui/icons';
  interface Props { tier: 'verified' | 'claimed'; }
  let { tier }: Props = $props();
</script>

<Badge variant={tier === 'verified' ? 'tier-verified' : 'tier-claimed'}>
  {#if tier === 'verified'}<Check size={12} />{/if}
  {tier}
</Badge>
