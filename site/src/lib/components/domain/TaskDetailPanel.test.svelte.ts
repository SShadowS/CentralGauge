import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import TaskDetailPanel from './TaskDetailPanel.svelte';
import type { TaskDetail } from '$shared/api-types';

const t: TaskDetail = {
  id: 'CG-AL-E001',
  difficulty: 'easy',
  content_hash: 'a'.repeat(64),
  task_set_hash: 'b'.repeat(64),
  category: { slug: 'syntax', name: 'Syntax' },
  manifest: { description: 'Test description', objective: 'Pass', files: ['test.al'] },
  solved_by: [
    { model_slug: 'sonnet-4-7', model_display: 'Sonnet 4.7', attempt_1_passed: 1, attempt_2_passed: null, runs_total: 5, avg_score: 0.92 },
    { model_slug: 'gpt-5',      model_display: 'GPT-5',      attempt_1_passed: 0, attempt_2_passed: 1,    runs_total: 4, avg_score: 0.66 },
  ],
};

describe('TaskDetailPanel', () => {
  it('renders the manifest description when present', () => {
    render(TaskDetailPanel, { task: t });
    expect(screen.getByText('Test description')).toBeDefined();
  });

  it('renders one row per solved-by entry', () => {
    const { container } = render(TaskDetailPanel, { task: t });
    expect(container.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('formats attempt cells as ✓ / ✗ / —', () => {
    render(TaskDetailPanel, { task: t });
    expect(screen.getAllByText('✓').length).toBeGreaterThan(0);
    expect(screen.getAllByText('✗').length).toBeGreaterThan(0);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
