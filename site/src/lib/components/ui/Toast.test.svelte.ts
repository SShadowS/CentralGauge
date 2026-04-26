import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Toast from './Toast.svelte';

describe('Toast', () => {
  it('renders message with role status', () => {
    render(Toast, { variant: 'info', children: 'Saved' });
    const t = screen.getByRole('status');
    expect(t.textContent).toContain('Saved');
  });
  it('renders role=alert with aria-live=assertive for error variant', () => {
    render(Toast, { variant: 'error', children: 'failed' });
    const t = screen.getByRole('alert');
    expect(t.textContent).toContain('failed');
    expect(t.getAttribute('aria-live')).toBe('assertive');
  });
});
