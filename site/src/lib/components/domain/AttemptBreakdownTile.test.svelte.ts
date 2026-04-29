import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import AttemptBreakdownTile from './AttemptBreakdownTile.svelte';

describe('AttemptBreakdownTile', () => {
  it('renders ratio + breakdown legend (4/10 pass)', () => {
    const { container, getByText } = render(AttemptBreakdownTile, {
      aggregates: {
        tasks_passed_attempt_1: 3,
        tasks_passed_attempt_2_only: 1,
        tasks_attempted_distinct: 10,
      },
    });
    // formatTaskRatio renders "4/10"
    expect(getByText('4/10')).toBeDefined();
    expect(container.querySelector('.bar')).not.toBeNull();
    // Legend lines present
    expect(getByText(/1st:\s*3/)).toBeDefined();
    expect(getByText(/2nd:\s*1/)).toBeDefined();
    expect(getByText(/Failed:\s*6/)).toBeDefined();
  });

  it('handles zero-attempt case gracefully', () => {
    const { getByText, container } = render(AttemptBreakdownTile, {
      aggregates: {
        tasks_passed_attempt_1: 0,
        tasks_passed_attempt_2_only: 0,
        tasks_attempted_distinct: 0,
      },
    });
    expect(getByText('0/0')).toBeDefined();
    expect(getByText(/Failed:\s*0/)).toBeDefined();
    expect(container.querySelector('.seg-empty')).not.toBeNull();
  });

  it('embeds AttemptStackedBar', () => {
    const { container } = render(AttemptBreakdownTile, {
      aggregates: {
        tasks_passed_attempt_1: 5,
        tasks_passed_attempt_2_only: 0,
        tasks_attempted_distinct: 10,
      },
    });
    expect(container.querySelector('.bar')).not.toBeNull();
    expect(container.querySelector('.seg-a1')).not.toBeNull();
  });
});
