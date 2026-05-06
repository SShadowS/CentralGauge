import type { Annotation } from '../types';

export const modelDetailAnnotations: Annotation[] = [
  {
    id: 'pass-tile',
    targetSelector: '[data-cheat="pass-tile"]',
    body: 'How often this model solves tasks (eventually, with up to 2 tries).',
    bodyPrefix: 'Pass@N',
    side: 'bottom',
    rotation: 2,
  },
  {
    id: 'avg-tile',
    targetSelector: '[data-cheat="avg-tile"]',
    body: 'Mean per-attempt score. Lower than Pass@N because failed attempts pull it down.',
    bodyPrefix: 'Avg attempt',
    side: 'bottom',
    rotation: -1,
  },
  {
    id: 'cost-tile',
    targetSelector: '[data-cheat="cost-tile"]',
    body: "Average dollar cost across all this model's benchmarks.",
    bodyPrefix: 'Cost',
    side: 'top',
    rotation: 1.5,
  },
  {
    id: 'history-chart',
    targetSelector: '[data-cheat="history-chart"]',
    body: 'Each dot is one benchmark run; trend over time.',
    bodyPrefix: 'History',
    side: 'right',
    rotation: -2,
  },
];
