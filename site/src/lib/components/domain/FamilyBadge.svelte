<script lang="ts">
  import Tag from '$lib/components/ui/Tag.svelte';
  interface Props { slug: string; }
  let { slug }: Props = $props();
</script>

<a class="link" href="/families/{slug}">
  <Tag variant="neutral">{slug}</Tag>
</a>

<style>
  .link { text-decoration: none; }
  .link:hover { text-decoration: none; }
</style>
