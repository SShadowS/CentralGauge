import { describe, it, expect } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Tabs from './Tabs.svelte';

const tabs = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma' },
];

const childrenSnippet = createRawSnippet((active) => ({
  render: () => `<div>panel: ${active()}</div>`,
}));

describe('Tabs', () => {
  it('renders tabs and the initial active panel', () => {
    render(Tabs, { tabs, active: 'a', children: childrenSnippet });
    expect(screen.getByRole('tab', { name: 'Alpha' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Beta' }).getAttribute('aria-selected')).toBe('false');
  });

  it('arrow-right moves active to the next tab', async () => {
    let activeNow = 'a';
    render(Tabs, {
      tabs,
      active: 'a',
      onchange: (id: string) => { activeNow = id; },
      children: childrenSnippet,
    });
    const tabA = screen.getByRole('tab', { name: 'Alpha' });
    tabA.focus();
    await fireEvent.keyDown(tabA, { key: 'ArrowRight' });
    expect(activeNow).toBe('b');
  });

  it('Home key jumps to first tab', async () => {
    let activeNow = 'c';
    render(Tabs, {
      tabs,
      active: 'c',
      onchange: (id: string) => { activeNow = id; },
      children: childrenSnippet,
    });
    const tabC = screen.getByRole('tab', { name: 'Gamma' });
    tabC.focus();
    await fireEvent.keyDown(tabC, { key: 'Home' });
    expect(activeNow).toBe('a');
  });
});
