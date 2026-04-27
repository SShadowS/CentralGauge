import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import CopyButton from './CopyButton.svelte';

describe('CopyButton', () => {
  it('calls clipboard.writeText on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(CopyButton, { value: 'hello' });
    await fireEvent.click(screen.getByRole('button'));
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('renders an aria-label', () => {
    render(CopyButton, { value: 'x', label: 'Copy SHA' });
    expect(screen.getByRole('button', { name: 'Copy SHA' })).toBeDefined();
  });
});
