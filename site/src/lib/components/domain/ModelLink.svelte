<script lang="ts">
  import FamilyBadge from './FamilyBadge.svelte';

  interface Props {
    slug: string;
    display_name: string;
    api_model_id: string;
    family_slug: string;
  }
  let { slug, display_name, api_model_id, family_slug }: Props = $props();
</script>

<div class="row">
  <a class="name" href="/models/{slug}">{display_name}</a>
  <FamilyBadge slug={family_slug} />
  <span class="api-id text-faint">{api_model_id}</span>
</div>

<style>
  .row {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
  }
  .name {
    font-weight: var(--weight-medium);
    color: var(--text);
    text-decoration: none;
  }
  .name:hover { color: var(--accent); }
  .api-id {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
</style>
