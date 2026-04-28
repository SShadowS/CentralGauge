import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import FailureModesList from './FailureModesList.svelte';
import type { FailureMode } from '$shared/api-types';

describe('FailureModesList', () => {
  it('renders one row per mode with code, count, message, search link', () => {
    const modes: FailureMode[] = [
      { code: 'AL0132', count: 3, pct: 0.5, example_message: 'expected ; got !' },
    ];
    const { container, getByText } = render(FailureModesList, { modes });
    expect(getByText('AL0132')).toBeDefined();
    expect(getByText('3')).toBeDefined();
    expect(container.querySelector('a.search')?.getAttribute('href')).toBe('/search?q=AL0132');
  });

  it('encodes spaces in code via encodeURIComponent', () => {
    const modes: FailureMode[] = [
      { code: 'AL 0132', count: 1, pct: 1, example_message: 'x' },
    ];
    const { container } = render(FailureModesList, { modes });
    expect(container.querySelector('a.search')?.getAttribute('href')).toBe('/search?q=AL%200132');
  });
});
