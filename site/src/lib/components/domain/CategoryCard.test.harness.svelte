<script lang="ts">
  import CategoryCard from './CategoryCard.svelte';
  import type { CategoriesIndexItem } from '$shared/api-types';

  let { item }: { item: CategoriesIndexItem } = $props();
</script>

<CategoryCard {item} />
