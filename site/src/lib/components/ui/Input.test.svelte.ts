import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Input from './Input.svelte';

describe('Input', () => {
  it('renders with a label', () => {
    render(Input, { label: 'Search', value: '', name: 'q' });
    expect(screen.getByLabelText('Search')).toBeDefined();
  });

  it('reflects value', () => {
    const { container } = render(Input, { label: 'X', value: 'hello' });
    const inp = container.querySelector('input') as HTMLInputElement;
    expect(inp.value).toBe('hello');
  });

  it('applies type attribute', () => {
    const { container } = render(Input, { label: 'N', type: 'number', value: '0' });
    const inp = container.querySelector('input') as HTMLInputElement;
    expect(inp.type).toBe('number');
  });

  it('shows error message and sets aria-invalid', () => {
    const { container } = render(Input, { label: 'X', value: '', error: 'required' });
    const inp = container.querySelector('input') as HTMLInputElement;
    expect(inp.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('required')).toBeDefined();
  });

  it('exposes the underlying <input> via bind:el', () => {
    const { container } = render(Input, { label: 'X', value: '' });
    // bind:el is exercised by the consumer; here we verify the inner element
    // exists and matches the type the consumer would receive.
    const inner = container.querySelector('input');
    expect(inner).not.toBeNull();
    expect(inner instanceof HTMLInputElement).toBe(true);
  });

  it('forwards ariaLabel to the input element', () => {
    const { container } = render(Input, { label: 'Search', value: '', ariaLabel: 'Search query' });
    const inp = container.querySelector('input') as HTMLInputElement;
    expect(inp.getAttribute('aria-label')).toBe('Search query');
  });

  it('forwards maxlength when provided', () => {
    const { container } = render(Input, { label: 'X', value: '', maxlength: 200 });
    const inp = container.querySelector('input') as HTMLInputElement;
    expect(inp.getAttribute('maxlength')).toBe('200');
  });

  it('hides the visible label when labelHidden is set', () => {
    const { container } = render(Input, { label: 'Search', value: '', labelHidden: true });
    const labelEl = container.querySelector('.label');
    expect(labelEl?.classList.contains('sr-only')).toBe(true);
  });

  it('autofocuses the input when autofocus is true', async () => {
    const { container } = render(Input, { label: 'X', value: '', autofocus: true });
    const inp = container.querySelector('input') as HTMLInputElement;
    // Allow the post-mount focus to land
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(inp);
  });
});
