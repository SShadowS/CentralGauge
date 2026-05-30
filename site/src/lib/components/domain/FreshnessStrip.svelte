<!-- site/src/lib/components/domain/FreshnessStrip.svelte -->
<script lang="ts">
  import { formatRelativeTime } from '$lib/client/format';
  interface Props {
    generatedAt: string;
    taskCount?: number;
  }
  let { generatedAt, taskCount }: Props = $props();
</script>

<p class="strip">
  <span>Updated {formatRelativeTime(generatedAt)}</span>
  {#if taskCount}<span>{taskCount} tasks</span>{/if}
  <span>2 attempts/model</span>
  <span>95% paired-bootstrap CI</span>
  <span class="formula">Solve AUC@2 = (pass@1 + solve@2) / 2</span>
</p>

<style>
  .strip {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: var(--space-4) 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  /* CSS-generated separator — decorative, never reaches the a11y tree. */
  .strip > span + span::before {
    content: "·";
    margin-right: var(--space-3);
    color: var(--text-faint);
  }
  .formula { color: var(--text-faint); }
</style>
