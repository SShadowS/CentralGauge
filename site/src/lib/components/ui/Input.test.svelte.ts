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
});
