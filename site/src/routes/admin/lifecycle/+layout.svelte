<!--
  Plan F / F6.1 — admin lifecycle layout.

  Cloudflare Access gates this route at the edge (see
  docs/site/operations.md "Admin lifecycle UI access" for the operator
  runbook). There is NO client-side login screen — by the time the page
  renders, the operator is authenticated. The layout assumes that.
-->
<script lang="ts">
  import { page } from '$app/state';
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  let { children } = $props();

  const navItems = [
    { href: '/admin/lifecycle', label: 'Overview' },
    { href: '/admin/lifecycle/review', label: 'Review queue' },
    { href: '/admin/lifecycle/status', label: 'Status matrix' },
  ];
</script>

<Breadcrumbs
  crumbs={[
    { label: 'Home', href: '/' },
    { label: 'Admin', href: '/admin/lifecycle' },
    { label: 'Lifecycle' },
  ]}
/>

<header class="admin-head">
  <h1>Lifecycle admin</h1>
  <p class="meta text-muted">
    Authenticated via Cloudflare Access. CLI uses the Ed25519 admin key.
  </p>
</header>

<nav class="admin-nav" aria-label="Admin sections">
  <ul>
    {#each navItems as item (item.href)}
      <li>
        <a
          href={item.href}
          aria-current={page.url.pathname === item.href ? 'page' : undefined}
        >
          {item.label}
        </a>
      </li>
    {/each}
  </ul>
</nav>

<main class="admin-main">
  {@render children()}
</main>

<style>
  .admin-head { padding: var(--space-6) 0 var(--space-4) 0; }
  .admin-head h1 { font-size: var(--text-3xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-2); }
  .admin-nav ul {
    display: flex; gap: var(--space-3);
    list-style: none; padding: 0; margin: 0 0 var(--space-5) 0;
    border-bottom: 1px solid var(--border);
  }
  .admin-nav a {
    display: inline-block; padding: var(--space-3) var(--space-4);
    color: var(--text-muted); text-decoration: none;
    border-bottom: 2px solid transparent;
  }
  .admin-nav a[aria-current='page'] {
    color: var(--text); border-bottom-color: var(--accent);
  }
</style>
