<script lang="ts">
  interface Props { passed: 0 | 1 | null; }
  let { passed }: Props = $props();

  const glyph = $derived(passed === null ? '—' : passed === 1 ? '✓' : '✗');
  const label = $derived(passed === null ? 'no attempt' : passed === 1 ? 'passed' : 'failed');
  const cls = $derived(passed === 1 ? 'pass' : passed === 0 ? 'fail' : 'none');
</script>

<span class="cell text-mono {cls}" aria-label={label}>{glyph}</span>

<style>
  .cell {
    display: inline-block;
    min-width: 1ch;
    text-align: center;
  }
  .cell.pass { color: var(--success); }
  .cell.fail { color: var(--danger); }
  .cell.none { color: var(--text-faint); }
</style>
