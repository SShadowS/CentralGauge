<script lang="ts">
  import type { FamiliesIndexItem } from '$shared/api-types';
  import { formatScore } from '$lib/client/format';
  import Card from '$lib/components/ui/Card.svelte';

  interface Props { items: FamiliesIndexItem[]; }
  let { items }: Props = $props();
</script>

<div class="grid">
  {#each items as f (f.slug)}
    <a class="card-link" href="/families/{f.slug}">
      <Card>
        <article class="fam">
          <header>
            <h2>{f.display_name}</h2>
            <p class="vendor text-muted">{f.vendor}</p>
          </header>
          <dl>
            <div><dt>Models</dt><dd class="text-mono">{f.model_count}</dd></div>
            <div>
              <dt>Best avg</dt>
              <dd class="text-mono">
                {#if f.latest_avg_score !== null}{formatScore(f.latest_avg_score)}{:else}<span class="text-faint">—</span>{/if}
              </dd>
            </div>
            {#if f.latest_model_slug}
              <div><dt>Latest</dt><dd class="text-mono"><span class="text-muted">{f.latest_model_slug}</span></dd></div>
            {/if}
          </dl>
          <footer class="text-muted">{f.model_count} {f.model_count === 1 ? 'model' : 'models'}</footer>
        </article>
      </Card>
    </a>
  {/each}
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--space-5);
  }
  .card-link { color: inherit; text-decoration: none; display: block; }
  .card-link:hover { text-decoration: none; }
  .fam header { margin-bottom: var(--space-4); }
  .fam h2 { font-size: var(--text-lg); margin: 0; }
  .vendor { font-size: var(--text-xs); margin-top: var(--space-1); }
  dl {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-3);
    margin: 0 0 var(--space-4) 0;
  }
  dl > div { display: flex; flex-direction: column; gap: var(--space-1); }
  dt { font-size: var(--text-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: var(--tracking-wide); }
  dd { margin: 0; font-size: var(--text-sm); color: var(--text); }
  footer { font-size: var(--text-xs); }
</style>
