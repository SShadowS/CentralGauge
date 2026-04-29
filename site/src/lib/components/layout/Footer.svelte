<script lang="ts">
  interface Props { buildSha?: string; buildAt?: string; }
  let { buildSha = 'dev', buildAt = '' }: Props = $props();
</script>

<footer class="footer">
  <div class="container">
    <div class="left">
      <a href="https://github.com/SShadowS/CentralGauge">Source on GitHub</a>
      <span aria-hidden="true">·</span>
      <a href="/about#transparency">Verified by Ed25519 signed ingest</a>
      <span aria-hidden="true">·</span>
      <a href="/changelog">Changelog</a>
    </div>
    <div class="right">
      Build <code>{buildSha}</code>{#if buildAt} · {buildAt}{/if}
    </div>
  </div>
</footer>

<style>
  .footer {
    border-top: 1px solid var(--border);
    padding: var(--space-6) 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    margin-top: var(--space-9);
  }
  .container {
    max-width: var(--container-wide);
    margin: 0 auto;
    padding: 0 var(--space-5);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-5);
    flex-wrap: wrap;
  }
  .left { display: flex; gap: var(--space-3); align-items: center; }
  code { background: var(--code-bg); padding: 0 var(--space-2); border-radius: var(--radius-1); }
</style>
