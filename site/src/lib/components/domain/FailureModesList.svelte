<script lang="ts">
  import type { FailureMode } from '$shared/api-types';

  interface Props { modes: FailureMode[]; }
  let { modes }: Props = $props();
</script>

<ul class="list">
  {#each modes as m}
    <li>
      <span class="code text-mono">{m.code}</span>
      <span class="bar" aria-hidden="true">
        <span class="fill" style:width="{m.pct * 100}%"></span>
      </span>
      <span class="count text-mono">{m.count}</span>
      <span class="msg text-muted">{m.example_message}</span>
      <a class="search" href="/search?q={encodeURIComponent(m.code)}">view all →</a>
    </li>
  {/each}
</ul>

<style>
  .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-3); }
  li {
    display: grid;
    grid-template-columns: auto 120px 60px 1fr auto;
    gap: var(--space-4);
    align-items: center;
    font-size: var(--text-sm);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--border);
  }
  .code { color: var(--accent); font-weight: var(--weight-medium); }
  .bar {
    display: inline-block;
    height: 6px;
    background: var(--border);
    border-radius: var(--radius-1);
    overflow: hidden;
  }
  .fill { display: block; height: 100%; background: var(--danger); }
  .count { color: var(--text-muted); text-align: right; }
  .msg { font-family: var(--font-mono); font-size: var(--text-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .search { font-size: var(--text-xs); }
</style>
