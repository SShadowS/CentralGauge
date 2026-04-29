<script lang="ts">
  import { Sun, Moon, Github, Command } from '$lib/components/ui/icons';
  import KeyHint from '$lib/components/ui/KeyHint.svelte';
  import DensityToggle from '$lib/components/domain/DensityToggle.svelte';
  import { paletteBus } from '$lib/client/palette-bus.svelte';
  import { getTheme, cycleTheme, type Theme } from '$lib/client/theme';
  import { onMount } from 'svelte';
  import { page } from '$app/state';

  let theme: Theme = $state('system');

  // Modifier key shown in the palette hint. SSR renders "Ctrl" — that's
  // the right default for Windows/Linux (the majority of visitors) and
  // avoids a hydration mismatch on those platforms. On Mac we swap to
  // "⌘" after mount; brief 1-frame layout shift is acceptable since
  // both labels occupy the same kbd width.
  let modKey: string = $state('Ctrl');

  onMount(() => {
    theme = getTheme();
    const platform =
      // navigator.userAgentData.platform is the modern API (Chromium); platform
      // is the legacy one (still present everywhere). Prefer the modern API.
      (navigator as Navigator & { userAgentData?: { platform?: string } })
        .userAgentData?.platform ?? navigator.platform ?? '';
    if (/mac|iphone|ipad/i.test(platform)) modKey = '⌘';
  });

  function toggleTheme() { theme = cycleTheme(); }
  function openPalette() { paletteBus.openPalette(); }

  // Read flag from layout data via $page.data (LayoutServer load propagates).
  const densityFlag = $derived(
    (page.data?.flags as { density_toggle?: boolean } | undefined)?.density_toggle ?? false,
  );
</script>

<nav class="nav" aria-label="Primary">
  <div class="container">
    <a class="logo" href="/" aria-label="CentralGauge home">CentralGauge</a>
    <ul class="links">
      <li><a href="/">Leaderboard</a></li>
      <li><a href="/models">Models</a></li>
      <li><a href="/categories">Categories</a></li>
      <li><a href="/tasks">Tasks</a></li>
      <li><a href="/matrix">Matrix</a></li>
      <li><a href="/compare">Compare</a></li>
      <li><a href="/search">Search</a></li>
    </ul>
    <div class="actions">
      <button type="button" class="palette-btn" onclick={openPalette} aria-label="Open command palette ({modKey}+K)">
        <Command size={16} />
        <span class="palette-label">Search…</span>
        <KeyHint keys={[modKey, 'K']} />
      </button>
      {#if densityFlag}
        <DensityToggle />
      {/if}
      <button class="icon-btn" onclick={toggleTheme} aria-label="Toggle theme (current: {theme})">
        {#if theme === 'dark'}<Moon size={18} />{:else}<Sun size={18} />{/if}
      </button>
      <a class="icon-btn" href="https://github.com/SShadowS/CentralGauge" aria-label="GitHub repository">
        <Github size={18} />
      </a>
    </div>
  </div>
</nav>

<style>
  .nav {
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    height: var(--nav-h);
    position: sticky;
    top: 0;
    z-index: var(--z-nav);
  }
  .container {
    height: 100%;
    max-width: var(--container-wide);
    margin: 0 auto;
    padding: 0 var(--space-5);
    display: flex;
    align-items: center;
    gap: var(--space-6);
  }
  .logo {
    font-weight: var(--weight-semi);
    color: var(--text);
    text-decoration: none;
    font-size: var(--text-base);
    letter-spacing: var(--tracking-tight);
  }
  .logo:hover { text-decoration: none; color: var(--accent); }
  .links {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: var(--space-5);
    flex: 1;
  }
  .links a {
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-decoration: none;
  }
  .links a:hover { color: var(--text); text-decoration: none; }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .palette-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-2) var(--space-4);
    color: var(--text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--text-sm);
  }
  .palette-btn:hover { color: var(--text); border-color: var(--border-strong); }
  .palette-label { color: var(--text-muted); }
  .icon-btn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    cursor: pointer;
  }
  .icon-btn:hover { color: var(--text); border-color: var(--border-strong); }

  @media (max-width: 768px) {
    .links { display: none; }
    .palette-label { display: none; }
  }
</style>
