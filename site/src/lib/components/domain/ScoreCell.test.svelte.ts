import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import ScoreCell from './ScoreCell.svelte';

describe('ScoreCell', () => {
  it('renders the formatted score', () => {
    const { container } = render(ScoreCell, { score: 0.84 });
    expect(container.textContent).toContain('0.84');
  });

  it('clamps the bar fill to 0% for negative scores', () => {
    const { container } = render(ScoreCell, { score: -0.5 });
    const fill = container.querySelector('.fill') as HTMLElement;
    expect(fill?.style.width).toBe('0%');
  });

  it('clamps the bar fill to 100% for scores above 1', () => {
    const { container } = render(ScoreCell, { score: 1.5 });
    const fill = container.querySelector('.fill') as HTMLElement;
    expect(fill?.style.width).toBe('100%');
  });

  it('renders a 50% bar fill for score 0.5', () => {
    const { container } = render(ScoreCell, { score: 0.5 });
    const fill = container.querySelector('.fill') as HTMLElement;
    expect(fill?.style.width).toBe('50%');
  });
});
