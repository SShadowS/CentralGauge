<script lang="ts">
  import { Sun, Moon, Github } from '$lib/components/ui/icons';
  import { getTheme, cycleTheme, type Theme } from '$lib/client/theme';
  import { onMount } from 'svelte';

  let theme: Theme = $state('system');

  onMount(() => {
    theme = getTheme();
  });

  function toggle() {
    theme = cycleTheme();
  }
</script>

<nav class="nav" aria-label="Primary">
  <div class="container">
    <a class="logo" href="/" aria-label="CentralGauge home">CentralGauge</a>
    <ul class="links">
      <li><a href="/leaderboard">Leaderboard</a></li>
      <li><a href="/models">Models</a></li>
      <li><a href="/tasks">Tasks</a></li>
      <li><a href="/compare">Compare</a></li>
      <li><a href="/search">Search</a></li>
    </ul>
    <div class="actions">
      <button class="icon-btn" onclick={toggle} aria-label="Toggle theme (current: {theme})">
        {#if theme === 'dark'}<Moon size={18} />{:else if theme === 'light'}<Sun size={18} />{:else}<Sun size={18} />{/if}
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
  }
</style>
