import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Dialog from './Dialog.svelte';

describe('Dialog', () => {
  it('renders title and message when open', () => {
    render(Dialog, {
      open: true,
      title: 'Confirm',
      message: 'Are you sure?',
      confirmLabel: 'Yes',
      cancelLabel: 'No',
    });
    expect(screen.getByText('Confirm')).toBeDefined();
    expect(screen.getByText('Are you sure?')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Yes' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'No' })).toBeDefined();
  });

  it('emits onconfirm when confirm clicked', async () => {
    let confirmed = false;
    render(Dialog, {
      open: true,
      title: 'X',
      message: 'Y',
      onconfirm: () => { confirmed = true; },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(confirmed).toBe(true);
  });

  it('emits oncancel when cancel clicked', async () => {
    let cancelled = false;
    render(Dialog, {
      open: true,
      title: 'X',
      message: 'Y',
      oncancel: () => { cancelled = true; },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancelled).toBe(true);
  });
});
