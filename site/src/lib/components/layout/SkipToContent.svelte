<a class="skip" href="#main">Skip to content</a>

<style>
  .skip {
    position: absolute;
    top: var(--space-2);
    left: var(--space-2);
    background: var(--accent);
    color: var(--accent-fg);
    padding: var(--space-3) var(--space-5);
    border-radius: var(--radius-2);
    font-weight: var(--weight-semi);
    z-index: calc(var(--z-nav) + 1);
    transform: translateY(-200%);
    transition: transform var(--duration-base) var(--ease);
  }
  .skip:focus { transform: translateY(0); text-decoration: none; }
</style>
