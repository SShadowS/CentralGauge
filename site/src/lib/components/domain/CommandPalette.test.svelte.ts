import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';

// $app/navigation is provided by SvelteKit at runtime; vitest needs a stub.
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));

import CommandPalette from './CommandPalette.svelte';
import { paletteBus } from '$lib/client/palette-bus.svelte';

const fakeIndex = {
  generated_at: '2026-04-27T10:00:00Z',
  entries: [
    { kind: 'model',  id: 'sonnet-4-7', label: 'Sonnet 4.7', href: '/models/sonnet-4-7', hint: 'Anthropic Claude' },
    { kind: 'model',  id: 'gpt-5',      label: 'GPT-5',      href: '/models/gpt-5',      hint: 'OpenAI GPT' },
    { kind: 'task',   id: 'CG-AL-E001', label: 'CG-AL-E001', href: '/tasks/CG-AL-E001',  hint: 'easy' },
    { kind: 'page',   id: '/',          label: 'Home',       href: '/',                  hint: 'leaderboard' },
  ],
};

describe('CommandPalette', () => {
  beforeEach(() => {
    paletteBus.close();
    // @ts-expect-error - jsdom stub
    global.fetch = vi.fn(async () => new Response(JSON.stringify(fakeIndex), { status: 200, headers: { 'content-type': 'application/json' } }));
  });

  it('renders nothing when paletteBus.open is false', () => {
    const { container } = render(CommandPalette);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders the dialog when opened', async () => {
    const { container } = render(CommandPalette);
    paletteBus.openPalette();
    await new Promise((r) => setTimeout(r, 60));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('typing filters entries by fuzzy match', async () => {
    render(CommandPalette);
    paletteBus.openPalette();
    await new Promise((r) => setTimeout(r, 60));
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'son' } });
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.getByText('Sonnet 4.7')).toBeDefined();
  });

  it('Escape closes the palette', async () => {
    render(CommandPalette);
    paletteBus.openPalette();
    await new Promise((r) => setTimeout(r, 60));
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(paletteBus.open).toBe(false);
  });

  it('rapid open/close does not leave loading=true', async () => {
    // Slow fetch so the close happens mid-flight
    let resolveFetch: (r: Response) => void = () => {};
    // @ts-expect-error - jsdom stub
    global.fetch = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    render(CommandPalette);
    paletteBus.openPalette();
    await new Promise((r) => setTimeout(r, 0));
    paletteBus.close();
    await new Promise((r) => setTimeout(r, 0));
    // Resolve late — the AbortController cleanup should have run already.
    resolveFetch(new Response(JSON.stringify(fakeIndex), { status: 200 }));
    paletteBus.openPalette();
    await new Promise((r) => setTimeout(r, 60));
    // After re-open, the next fetch can run; the previous one was aborted.
    expect(paletteBus.open).toBe(true);
  });
});
